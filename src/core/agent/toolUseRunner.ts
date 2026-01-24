import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import type { Tool, ToolUseContext } from '@tool'
import type { CanUseToolFn } from '@kode-types/canUseTool'
import { logError } from '@utils/log'
import {
  debug as debugLogger,
  getCurrentRequest,
  logUserFriendly,
} from '@utils/log/debugLogger'
import {
  createAssistantMessage,
  createProgressMessage,
  createUserMessage,
} from '@utils/messages'
import { resolveToolNameAlias } from '@utils/tooling/toolNameAliases'
import { getCwd } from '@utils/state'
import {
  formatToolStatusDetail,
  setRequestStatus,
} from '@utils/session/requestStatus'
import {
  getHookTranscriptPath,
  queueHookAdditionalContexts,
  queueHookSystemMessages,
  runPostToolUseHooks,
  runPreToolUseHooks,
} from '@utils/session/kodeHooks'
import { BashTool } from '@tools/BashTool/BashTool'
import type { Message, AssistantMessage, ExtendedToolUseContext } from './types'

export function normalizeToolInput(
  tool: Tool,
  input: Record<string, unknown>,
): Record<string, unknown> {
  switch (tool) {
    case BashTool: {
      const parsed = BashTool.inputSchema.parse(input)
      const {
        command,
        timeout,
        description,
        run_in_background,
        dangerouslyDisableSandbox,
      } = parsed
      return {
        command: command
          .replace(`cd ${getCwd()} && `, '')
          .replace(/\\\\;/g, '\\;'),
        ...(timeout !== undefined ? { timeout } : {}),
        ...(description ? { description } : {}),
        ...(run_in_background ? { run_in_background } : {}),
        ...(dangerouslyDisableSandbox ? { dangerouslyDisableSandbox } : {}),
      }
    }
    default:
      return input
  }
}

function preprocessToolInput(
  tool: Tool,
  input: Record<string, unknown>,
): Record<string, unknown> {
  if (tool.name === 'TaskOutput') {
    const task_id =
      (typeof input.task_id === 'string' && input.task_id) ||
      (typeof (input as any).agentId === 'string' &&
        String((input as any).agentId)) ||
      (typeof (input as any).bash_id === 'string' &&
        String((input as any).bash_id)) ||
      ''

    const block = typeof input.block === 'boolean' ? input.block : true

    const timeout =
      typeof input.timeout === 'number'
        ? input.timeout
        : typeof (input as any).wait_up_to === 'number'
          ? Number((input as any).wait_up_to) * 1000
          : undefined

    return {
      task_id,
      block,
      ...(timeout !== undefined ? { timeout } : {}),
    }
  }

  return input
}

export async function* runToolUse(
  toolUse: ToolUseBlock,
  siblingToolUseIDs: Set<string>,
  assistantMessage: AssistantMessage,
  canUseTool: CanUseToolFn,
  toolUseContext: ExtendedToolUseContext,
  shouldSkipPermissionCheck?: boolean,
): AsyncGenerator<Message, void> {
  const currentRequest = getCurrentRequest()
  const aliasResolution = resolveToolNameAlias(toolUse.name)
  const toolDetail = formatToolStatusDetail(
    aliasResolution.resolvedName,
    toolUse.input && typeof toolUse.input === 'object'
      ? (toolUse.input as Record<string, unknown>)
      : null,
  )
  setRequestStatus({
    kind: 'tool',
    detail: toolDetail ?? aliasResolution.resolvedName,
  })

  debugLogger.flow('TOOL_USE_START', {
    toolName: toolUse.name,
    toolUseID: toolUse.id,
    inputSize: JSON.stringify(toolUse.input).length,
    siblingToolCount: siblingToolUseIDs.size,
    shouldSkipPermissionCheck: !!shouldSkipPermissionCheck,
    requestId: currentRequest?.id,
  })

  logUserFriendly(
    'TOOL_EXECUTION',
    {
      toolName: toolUse.name,
      action: 'Starting',
      target: toolUse.input ? Object.keys(toolUse.input).join(', ') : '',
    },
    currentRequest?.id,
  )

  const toolName = aliasResolution.resolvedName
  const tool = toolUseContext.options.tools.find(t => t.name === toolName)

  if (!tool) {
    debugLogger.error('TOOL_NOT_FOUND', {
      requestedTool: toolName,
      availableTools: toolUseContext.options.tools.map(t => t.name),
      toolUseID: toolUse.id,
      requestId: currentRequest?.id,
    })

    yield createUserMessage([
      {
        type: 'tool_result',
        content: `Error: No such tool available: ${toolName}`,
        is_error: true,
        tool_use_id: toolUse.id,
      },
    ])
    return
  }

  const toolInput = toolUse.input as Record<string, unknown>

  const inputKeys = Object.keys(toolInput)
  const isEmptyInput = inputKeys.length === 0

  debugLogger.flow('TOOL_INPUT_RECEIVED', {
    toolName: tool.name,
    toolUseID: toolUse.id,
    inputKeys,
    inputEmpty: isEmptyInput,
    inputSize: JSON.stringify(toolInput).length,
    rawInputPreview: JSON.stringify(toolInput).slice(0, 200),
    requestId: currentRequest?.id,
  })

  if (isEmptyInput) {
    debugLogger.warn('TOOL_CALLED_WITH_EMPTY_INPUT', {
      toolName: tool.name,
      toolUseID: toolUse.id,
      expectedSchema: tool.inputSchema.description,
      requestId: currentRequest?.id,
    })
  }

  debugLogger.flow('TOOL_VALIDATION_START', {
    toolName: tool.name,
    toolUseID: toolUse.id,
    inputKeys,
    requestId: currentRequest?.id,
  })

  try {
    for await (const message of checkPermissionsAndCallTool(
      tool,
      toolUse.id,
      siblingToolUseIDs,
      toolInput,
      toolUseContext,
      canUseTool,
      assistantMessage,
      shouldSkipPermissionCheck,
    )) {
      yield message
    }
  } catch (e) {
    logError(e)

    const errorMessage = createUserMessage([
      {
        type: 'tool_result',
        content: `Tool execution failed: ${e instanceof Error ? e.message : String(e)}`,
        is_error: true,
        tool_use_id: toolUse.id,
      },
    ])
    yield errorMessage
  }
}

async function* checkPermissionsAndCallTool(
  tool: Tool,
  toolUseID: string,
  siblingToolUseIDs: Set<string>,
  input: Record<string, unknown>,
  context: ToolUseContext,
  canUseTool: CanUseToolFn,
  assistantMessage: AssistantMessage,
  shouldSkipPermissionCheck?: boolean,
): AsyncGenerator<Message, void> {
  const preprocessedInput = preprocessToolInput(tool, input)
  const isValidInput = tool.inputSchema.safeParse(preprocessedInput)
  if (!isValidInput.success) {
    let errorMessage = `InputValidationError: ${isValidInput.error.message}`

    const inputKeys = Object.keys(preprocessedInput)
    const isEmptyInput = inputKeys.length === 0

    if (tool.name === 'Read' && isEmptyInput) {
      errorMessage = `Error: The Read tool requires a 'file_path' parameter to specify which file to read. Please provide the absolute path to the file you want to read. For example: {\"file_path\": \"/path/to/file.txt\"}`
    } else if (tool.name === 'Write' && isEmptyInput) {
      errorMessage = `Error: The Write tool requires both 'file_path' and 'content' parameters. Please provide them as: {\"file_path\": \"/absolute/path/to/file\", \"content\": \"file content here\"}. Both parameters are REQUIRED.`
    } else if (tool.name === 'Edit' && isEmptyInput) {
      errorMessage = `Error: The Edit tool requires 'file_path', 'old_string', and 'new_string' parameters. Please provide all three parameters.`
    } else if (isEmptyInput) {
      errorMessage = `Error: The ${tool.name} tool was called with no parameters. Please check the tool definition and provide all required parameters. Tool input was: ${JSON.stringify(preprocessedInput)}`
    }

    debugLogger.error('TOOL_INPUT_VALIDATION_FAILED', {
      toolName: tool.name,
      toolUseID,
      inputKeys,
      isEmptyInput,
      validationErrors: isValidInput.error.errors,
      rawInput: JSON.stringify(preprocessedInput).slice(0, 500),
    })

    yield createUserMessage([
      {
        type: 'tool_result',
        content: errorMessage,
        is_error: true,
        tool_use_id: toolUseID,
      },
    ])
    return
  }

  let normalizedInput = normalizeToolInput(tool, isValidInput.data)

  const isValidCall = await tool.validateInput?.(
    normalizedInput as never,
    context,
  )
  if (isValidCall?.result === false) {
    yield createUserMessage([
      {
        type: 'tool_result',
        content: isValidCall!.message,
        is_error: true,
        tool_use_id: toolUseID,
      },
    ])
    return
  }

  const hookOutcome = await runPreToolUseHooks({
    toolName: tool.name,
    toolInput: normalizedInput,
    toolUseId: toolUseID,
    permissionMode: context.options?.toolPermissionContext?.mode,
    cwd: getCwd(),
    transcriptPath: getHookTranscriptPath(context),
    safeMode: context.options?.safeMode ?? false,
    signal: context.abortController.signal,
  })
  if (hookOutcome.kind === 'block') {
    yield createUserMessage([
      {
        type: 'tool_result',
        content: hookOutcome.message,
        is_error: true,
        tool_use_id: toolUseID,
      },
    ])
    return
  }
  if (hookOutcome.warnings.length > 0) {
    const warningText = hookOutcome.warnings.join('\n')
    yield createProgressMessage(
      toolUseID,
      siblingToolUseIDs,
      createAssistantMessage(warningText),
      [],
      context.options?.tools ?? [],
    )
  }

  if (hookOutcome.systemMessages && hookOutcome.systemMessages.length > 0) {
    queueHookSystemMessages(context, hookOutcome.systemMessages)
  }
  if (
    hookOutcome.additionalContexts &&
    hookOutcome.additionalContexts.length > 0
  ) {
    queueHookAdditionalContexts(context, hookOutcome.additionalContexts)
  }

  if (hookOutcome.updatedInput) {
    const merged = { ...normalizedInput, ...hookOutcome.updatedInput }
    const parsed = tool.inputSchema.safeParse(merged)
    if (!parsed.success) {
      yield createUserMessage([
        {
          type: 'tool_result',
          content: `Hook updatedInput failed validation: ${parsed.error.message}`,
          is_error: true,
          tool_use_id: toolUseID,
        },
      ])
      return
    }
    normalizedInput = normalizeToolInput(tool, parsed.data)
    const isValidUpdate = await tool.validateInput?.(
      normalizedInput as never,
      context,
    )
    if (isValidUpdate?.result === false) {
      yield createUserMessage([
        {
          type: 'tool_result',
          content: isValidUpdate.message,
          is_error: true,
          tool_use_id: toolUseID,
        },
      ])
      return
    }
  }

  const hookPermissionDecision =
    hookOutcome.kind === 'allow' ? hookOutcome.permissionDecision : undefined

  const effectiveShouldSkipPermissionCheck =
    hookPermissionDecision === 'allow'
      ? true
      : hookPermissionDecision === 'ask'
        ? false
        : shouldSkipPermissionCheck

  const permissionContextForCall =
    hookPermissionDecision === 'ask' &&
    context.options?.toolPermissionContext &&
    context.options.toolPermissionContext.mode !== 'default'
      ? ({
          ...context,
          options: {
            ...context.options,
            toolPermissionContext: {
              ...context.options.toolPermissionContext,
              mode: 'default',
            },
          },
        } as const)
      : context

  const permissionResult = effectiveShouldSkipPermissionCheck
    ? ({ result: true } as const)
    : await canUseTool(
        tool,
        normalizedInput,
        { ...permissionContextForCall, toolUseId: toolUseID },
        assistantMessage,
      )
  if (permissionResult.result === false) {
    yield createUserMessage([
      {
        type: 'tool_result',
        content: permissionResult.message,
        is_error: true,
        tool_use_id: toolUseID,
      },
    ])
    return
  }

  try {
    const generator = tool.call(normalizedInput as never, {
      ...context,
      toolUseId: toolUseID,
    })
    for await (const result of generator) {
      switch (result.type) {
        case 'result':
          {
            const content =
              result.resultForAssistant ??
              tool.renderResultForAssistant(result.data as never)

            const postOutcome = await runPostToolUseHooks({
              toolName: tool.name,
              toolInput: normalizedInput,
              toolResult: result.data,
              toolUseId: toolUseID,
              permissionMode: context.options?.toolPermissionContext?.mode,
              cwd: getCwd(),
              transcriptPath: getHookTranscriptPath(context),
              safeMode: context.options?.safeMode ?? false,
              signal: context.abortController.signal,
            })
            if (postOutcome.systemMessages.length > 0) {
              queueHookSystemMessages(context, postOutcome.systemMessages)
            }
            if (postOutcome.additionalContexts.length > 0) {
              queueHookAdditionalContexts(
                context,
                postOutcome.additionalContexts,
              )
            }
            if (postOutcome.warnings.length > 0) {
              const warningText = postOutcome.warnings.join('\n')
              yield createProgressMessage(
                toolUseID,
                siblingToolUseIDs,
                createAssistantMessage(warningText),
                [],
                context.options?.tools ?? [],
              )
            }

            yield createUserMessage(
              [
                {
                  type: 'tool_result',
                  content: content as any,
                  tool_use_id: toolUseID,
                },
              ],
              {
                data: result.data,
                resultForAssistant: content as any,
                ...(Array.isArray(result.newMessages)
                  ? { newMessages: result.newMessages as any }
                  : {}),
                ...(result.contextModifier
                  ? { contextModifier: result.contextModifier as any }
                  : {}),
              },
            )

            if (Array.isArray(result.newMessages)) {
              for (const message of result.newMessages) {
                if (
                  message &&
                  typeof message === 'object' &&
                  'type' in (message as any)
                ) {
                  yield message as any
                }
              }
            }
          }
          return
        case 'progress':
          yield createProgressMessage(
            toolUseID,
            siblingToolUseIDs,
            result.content,
            result.normalizedMessages || [],
            result.tools || [],
          )
          break
      }
    }
  } catch (error) {
    const content = formatError(error)
    logError(error)

    yield createUserMessage([
      {
        type: 'tool_result',
        content,
        is_error: true,
        tool_use_id: toolUseID,
      },
    ])
  }
}

function formatError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error)
  }
  const parts = [error.message]
  if ('stderr' in error && typeof error.stderr === 'string') {
    parts.push(error.stderr)
  }
  if ('stdout' in error && typeof error.stdout === 'string') {
    parts.push(error.stdout)
  }
  const fullMessage = parts.filter(Boolean).join('\n')
  if (fullMessage.length <= 10000) {
    return fullMessage
  }
  const halfLength = 5000
  const start = fullMessage.slice(0, halfLength)
  const end = fullMessage.slice(-halfLength)
  return `${start}\n\n... [${fullMessage.length - 10000} characters truncated] ...\n\n${end}`
}
