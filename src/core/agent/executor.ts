/**
 * Tool Executor
 *
 * Handles tool execution with concurrency control, permission checking,
 * and hook integration.
 */

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
  REJECT_MESSAGE,
} from '@utils/messages'
import { resolveToolNameAlias } from '@utils/tooling/toolNameAliases'
import { getCwd } from '@utils/state'
import { setRequestStatus } from '@utils/session/requestStatus'
import {
  getHookTranscriptPath,
  queueHookAdditionalContexts,
  queueHookSystemMessages,
  runPostToolUseHooks,
  runPreToolUseHooks,
} from '@utils/session/kodeHooks'
import { BashTool } from '@tools/BashTool/BashTool'
import type {
  Message,
  UserMessage,
  AssistantMessage,
  ProgressMessage,
  ToolQueueEntry,
  ExtendedToolUseContext,
  ToolUseQueueOptions,
} from './types'

// ============================================================================
// Synthetic Error Messages
// ============================================================================

function createSyntheticToolUseErrorMessage(
  toolUseId: string,
  reason: 'user_interrupted' | 'sibling_error',
): UserMessage {
  if (reason === 'user_interrupted') {
    return createUserMessage([
      {
        type: 'tool_result',
        content: REJECT_MESSAGE,
        is_error: true,
        tool_use_id: toolUseId,
      },
    ])
  }

  return createUserMessage([
    {
      type: 'tool_result',
      content: '<tool_use_error>Sibling tool call errored</tool_use_error>',
      is_error: true,
      tool_use_id: toolUseId,
    },
  ])
}

// ============================================================================
// Tool Use Queue - Concurrent Tool Execution Manager
// ============================================================================

export class ToolUseQueue {
  private toolDefinitions: Tool[]
  private canUseTool: CanUseToolFn
  private tools: ToolQueueEntry[] = []
  private toolUseContext: ExtendedToolUseContext
  private hasErrored = false
  private progressAvailableResolve: (() => void) | undefined
  private siblingToolUseIDs: Set<string>
  private shouldSkipPermissionCheck?: boolean

  constructor(options: ToolUseQueueOptions) {
    this.toolDefinitions = options.toolDefinitions
    this.canUseTool = options.canUseTool
    this.toolUseContext = options.toolUseContext
    this.siblingToolUseIDs = options.siblingToolUseIDs
    this.shouldSkipPermissionCheck = options.shouldSkipPermissionCheck
  }

  addTool(toolUse: ToolUseBlock, assistantMessage: AssistantMessage) {
    const resolvedToolName = resolveToolNameAlias(toolUse.name).resolvedName
    const toolDefinition = this.toolDefinitions.find(
      t => t.name === resolvedToolName,
    )
    const parsedInput = toolDefinition?.inputSchema.safeParse(toolUse.input)
    const isConcurrencySafe =
      toolDefinition && parsedInput?.success
        ? toolDefinition.isConcurrencySafe(parsedInput.data as any)
        : false

    this.tools.push({
      id: toolUse.id,
      block: toolUse,
      assistantMessage,
      status: 'queued',
      isConcurrencySafe,
      pendingProgress: [],
      queuedProgressEmitted: false,
    })

    void this.processQueue()
  }

  private canExecuteTool(isConcurrencySafe: boolean) {
    const executing = this.tools.filter(t => t.status === 'executing')
    return (
      executing.length === 0 ||
      (isConcurrencySafe && executing.every(t => t.isConcurrencySafe))
    )
  }

  private async processQueue() {
    for (const entry of this.tools) {
      if (entry.status !== 'queued') continue

      if (this.canExecuteTool(entry.isConcurrencySafe)) {
        await this.executeTool(entry)
      } else {
        if (!entry.queuedProgressEmitted) {
          entry.queuedProgressEmitted = true
          entry.pendingProgress.push(
            createProgressMessage(
              entry.id,
              this.siblingToolUseIDs,
              createAssistantMessage('<tool-progress>Waiting…</tool-progress>'),
              [],
              this.toolUseContext.options.tools,
            ),
          )
          if (this.progressAvailableResolve) {
            this.progressAvailableResolve()
            this.progressAvailableResolve = undefined
          }
        }

        if (!entry.isConcurrencySafe) {
          break
        }
      }
    }
  }

  private getAbortReason(): 'sibling_error' | 'user_interrupted' | null {
    if (this.hasErrored) return 'sibling_error'
    if (this.toolUseContext.abortController.signal.aborted)
      return 'user_interrupted'
    return null
  }

  private async executeTool(entry: ToolQueueEntry) {
    entry.status = 'executing'

    const results: (UserMessage | AssistantMessage)[] = []
    const contextModifiers: Array<
      (ctx: ExtendedToolUseContext) => ExtendedToolUseContext
    > = []

    const promise = (async () => {
      const abortReason = this.getAbortReason()
      if (abortReason) {
        results.push(createSyntheticToolUseErrorMessage(entry.id, abortReason))
        entry.results = results
        entry.contextModifiers = contextModifiers
        entry.status = 'completed'
        return
      }

      const generator = runToolUse(
        entry.block,
        this.siblingToolUseIDs,
        entry.assistantMessage,
        this.canUseTool,
        this.toolUseContext,
        this.shouldSkipPermissionCheck,
      )

      let toolErrored = false

      for await (const message of generator) {
        const reason = this.getAbortReason()
        if (reason && !toolErrored) {
          results.push(createSyntheticToolUseErrorMessage(entry.id, reason))
          break
        }

        if (
          message.type === 'user' &&
          Array.isArray(message.message.content) &&
          message.message.content.some(
            block => block.type === 'tool_result' && block.is_error === true,
          )
        ) {
          this.hasErrored = true
          toolErrored = true
        }

        if (message.type === 'progress') {
          entry.pendingProgress.push(message)
          if (this.progressAvailableResolve) {
            this.progressAvailableResolve()
            this.progressAvailableResolve = undefined
          }
        } else {
          results.push(message)

          if (
            message.type === 'user' &&
            message.toolUseResult?.contextModifier
          ) {
            contextModifiers.push(
              message.toolUseResult.contextModifier.modifyContext as any,
            )
          }
        }
      }

      entry.results = results
      entry.contextModifiers = contextModifiers
      entry.status = 'completed'

      if (!entry.isConcurrencySafe && contextModifiers.length > 0) {
        for (const modifyContext of contextModifiers) {
          this.toolUseContext = modifyContext(this.toolUseContext)
        }
      }
    })()

    entry.promise = promise
    promise.finally(() => {
      void this.processQueue()
    })
  }

  private *getCompletedResults(): Generator<Message, void> {
    let barrierExecuting = false
    for (const entry of this.tools) {
      while (entry.pendingProgress.length > 0) {
        yield entry.pendingProgress.shift()!
      }

      if (entry.status === 'yielded') continue

      if (barrierExecuting) continue

      if (entry.status === 'completed' && entry.results) {
        entry.status = 'yielded'
        for (const message of entry.results) {
          yield message
        }
      } else if (entry.status === 'executing' && !entry.isConcurrencySafe) {
        barrierExecuting = true
      }
    }
  }

  private hasPendingProgress() {
    return this.tools.some(t => t.pendingProgress.length > 0)
  }

  private hasCompletedResults() {
    return this.tools.some(t => t.status === 'completed')
  }

  private hasExecutingTools() {
    return this.tools.some(t => t.status === 'executing')
  }

  private hasUnfinishedTools() {
    return this.tools.some(t => t.status !== 'yielded')
  }

  async *getRemainingResults(): AsyncGenerator<Message, void> {
    while (this.hasUnfinishedTools()) {
      await this.processQueue()

      for (const message of this.getCompletedResults()) {
        yield message
      }

      if (
        this.hasExecutingTools() &&
        !this.hasCompletedResults() &&
        !this.hasPendingProgress()
      ) {
        const promises = this.tools
          .filter(t => t.status === 'executing' && t.promise)
          .map(t => t.promise!)

        const progressPromise = new Promise<void>(resolve => {
          this.progressAvailableResolve = resolve
        })

        if (promises.length > 0) {
          await Promise.race([...promises, progressPromise])
        }
      }
    }

    for (const message of this.getCompletedResults()) {
      yield message
    }
  }

  getUpdatedContext() {
    return this.toolUseContext
  }
}

// ============================================================================
// Tool Input Processing
// ============================================================================

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

// ============================================================================
// Tool Execution
// ============================================================================

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
  setRequestStatus({ kind: 'tool', detail: aliasResolution.resolvedName })

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

  debugLogger.flow('TOOL_VALIDATION_START', {
    toolName: tool.name,
    toolUseID: toolUse.id,
    inputKeys: Object.keys(toolInput),
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

// ============================================================================
// Permission Checking and Tool Calling
// ============================================================================

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

    if (tool.name === 'Read' && Object.keys(preprocessedInput).length === 0) {
      errorMessage = `Error: The Read tool requires a 'file_path' parameter to specify which file to read. Please provide the absolute path to the file you want to read. For example: {"file_path": "/path/to/file.txt"}`
    }

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

// ============================================================================
// Error Formatting
// ============================================================================

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

// ============================================================================
// Test Exports
// ============================================================================

export const __ToolUseQueueForTests = ToolUseQueue
