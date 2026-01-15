/**
 * Agent Orchestrator
 *
 * Main agent loop that coordinates LLM queries, tool execution,
 * and message flow.
 */

import type { CanUseToolFn } from '@kode-types/canUseTool'
import { queryLLM } from '@services/llmLazy'
import { formatSystemPromptWithContext } from '@services/systemPrompt'
import { emitReminderEvent } from '@services/systemReminder'
import { getOutputStyleSystemPromptAdditions } from '@services/outputStyles'
import { markPhase, getCurrentRequest } from '@utils/log/debugLogger'
import {
  createAssistantMessage,
  INTERRUPT_MESSAGE,
  INTERRUPT_MESSAGE_FOR_TOOL_USE,
  normalizeMessagesForAPI,
} from '@utils/messages'
import { appendSessionJsonlFromMessage } from '@utils/protocol/kodeAgentSessionLog'
import {
  getPlanModeSystemPromptAdditions,
  hydratePlanSlugFromMessages,
} from '@utils/plan/planMode'
import { setRequestStatus } from '@utils/session/requestStatus'
import {
  BunShell,
  renderBackgroundShellStatusAttachment,
  renderBashNotification,
} from '@utils/bun/shell'
import { getCwd } from '@utils/state'
import { checkAutoCompact } from '@utils/session/autoCompactCore'
import {
  drainHookSystemPromptAdditions,
  getHookTranscriptPath,
  queueHookAdditionalContexts,
  queueHookSystemMessages,
  runStopHooks,
  runUserPromptSubmitHooks,
  updateHookTranscriptForMessages,
} from '@utils/session/kodeHooks'
import {
  messagePairValidForBinaryFeedback,
  shouldUseBinaryFeedback,
} from '../app/binaryFeedback'
import { ToolUseQueue } from './executor'
import type {
  Message,
  UserMessage,
  AssistantMessage,
  ExtendedToolUseContext,
  BinaryFeedbackResult,
  HookState,
} from './types'
import { isToolUseLikeBlock } from './types'

// ============================================================================
// Binary Feedback
// ============================================================================

async function queryWithBinaryFeedback(
  toolUseContext: ExtendedToolUseContext,
  getAssistantResponse: () => Promise<AssistantMessage>,
  getBinaryFeedbackResponse?: (
    m1: AssistantMessage,
    m2: AssistantMessage,
  ) => Promise<BinaryFeedbackResult>,
): Promise<BinaryFeedbackResult> {
  if (
    process.env.USER_TYPE !== 'ant' ||
    !getBinaryFeedbackResponse ||
    !(await shouldUseBinaryFeedback())
  ) {
    const assistantMessage = await getAssistantResponse()
    if (toolUseContext.abortController.signal.aborted) {
      return { message: null, shouldSkipPermissionCheck: false }
    }
    return { message: assistantMessage, shouldSkipPermissionCheck: false }
  }
  const [m1, m2] = await Promise.all([
    getAssistantResponse(),
    getAssistantResponse(),
  ])
  if (toolUseContext.abortController.signal.aborted) {
    return { message: null, shouldSkipPermissionCheck: false }
  }
  if (m2.isApiErrorMessage) {
    return { message: m1, shouldSkipPermissionCheck: false }
  }
  if (m1.isApiErrorMessage) {
    return { message: m2, shouldSkipPermissionCheck: false }
  }
  if (!messagePairValidForBinaryFeedback(m1, m2)) {
    return { message: m1, shouldSkipPermissionCheck: false }
  }
  return await getBinaryFeedbackResponse(m1, m2)
}

// ============================================================================
// Main Query Function (Public API)
// ============================================================================

export async function* query(
  messages: Message[],
  systemPrompt: string[],
  context: { [k: string]: string },
  canUseTool: CanUseToolFn,
  toolUseContext: ExtendedToolUseContext,
  getBinaryFeedbackResponse?: (
    m1: AssistantMessage,
    m2: AssistantMessage,
  ) => Promise<BinaryFeedbackResult>,
): AsyncGenerator<Message, void> {
  const shouldPersistSession =
    toolUseContext.options?.persistSession !== false &&
    process.env.NODE_ENV !== 'test'

  for await (const message of queryCore(
    messages,
    systemPrompt,
    context,
    canUseTool,
    toolUseContext,
    getBinaryFeedbackResponse,
  )) {
    if (shouldPersistSession) {
      appendSessionJsonlFromMessage({ message, toolUseContext })
    }
    yield message
  }
}

// ============================================================================
// Core Query Loop (Recursive)
// ============================================================================

async function* queryCore(
  messages: Message[],
  systemPrompt: string[],
  context: { [k: string]: string },
  canUseTool: CanUseToolFn,
  toolUseContext: ExtendedToolUseContext,
  getBinaryFeedbackResponse?: (
    m1: AssistantMessage,
    m2: AssistantMessage,
  ) => Promise<BinaryFeedbackResult>,
  hookState?: HookState,
): AsyncGenerator<Message, void> {
  setRequestStatus({ kind: 'thinking' })

  try {
    const currentRequest = getCurrentRequest()

    markPhase('QUERY_INIT')
    const stopHookActive = hookState?.stopHookActive === true
    const stopHookAttempts = hookState?.stopHookAttempts ?? 0

    // ========================================================================
    // Phase 1: Pre-processing
    // ========================================================================

    const { messages: processedMessages, wasCompacted } =
      await checkAutoCompact(messages, toolUseContext)
    if (wasCompacted) {
      messages = processedMessages
    }

    // Handle background shell notifications (main agent only)
    if (toolUseContext.agentId === 'main') {
      const shell = BunShell.getInstance()

      const notifications = shell.flushBashNotifications()
      for (const notification of notifications) {
        const text = renderBashNotification(notification)
        if (text.trim().length === 0) continue
        const msg = createAssistantMessage(text)
        messages = [...messages, msg]
        yield msg
      }

      const attachments = shell.flushBackgroundShellStatusAttachments()
      for (const attachment of attachments) {
        const text = renderBackgroundShellStatusAttachment(attachment)
        if (text.trim().length === 0) continue
        const msg = createAssistantMessage(
          `<tool-progress>${text}</tool-progress>`,
        )
        messages = [...messages, msg]
        yield msg
      }
    }

    updateHookTranscriptForMessages(toolUseContext, messages)

    // Process user prompt hooks
    {
      const last = messages[messages.length - 1]
      let userPromptText: string | null = null
      if (last && typeof last === 'object' && (last as any).type === 'user') {
        const content = (last as any).message?.content
        if (typeof content === 'string') {
          userPromptText = content
        } else if (Array.isArray(content)) {
          const hasToolResult = content.some(
            (b: any) => b && typeof b === 'object' && b.type === 'tool_result',
          )
          if (!hasToolResult) {
            userPromptText = content
              .filter(
                (b: any) => b && typeof b === 'object' && b.type === 'text',
              )
              .map((b: any) => String(b.text ?? ''))
              .join('')
          }
        }
      }

      if (userPromptText !== null) {
        toolUseContext.options.lastUserPrompt = userPromptText

        const promptOutcome = await runUserPromptSubmitHooks({
          prompt: userPromptText,
          permissionMode: toolUseContext.options?.toolPermissionContext?.mode,
          cwd: getCwd(),
          transcriptPath: getHookTranscriptPath(toolUseContext),
          safeMode: toolUseContext.options?.safeMode ?? false,
          signal: toolUseContext.abortController.signal,
        })

        queueHookSystemMessages(toolUseContext, promptOutcome.systemMessages)
        queueHookAdditionalContexts(
          toolUseContext,
          promptOutcome.additionalContexts,
        )

        if (promptOutcome.decision === 'block') {
          yield createAssistantMessage(promptOutcome.message)
          return
        }
      }
    }

    // ========================================================================
    // Phase 2: Build System Prompt
    // ========================================================================

    markPhase('SYSTEM_PROMPT_BUILD')

    hydratePlanSlugFromMessages(messages as any[], toolUseContext)

    const { systemPrompt: fullSystemPrompt, reminders } =
      formatSystemPromptWithContext(
        systemPrompt,
        context,
        toolUseContext.agentId,
      )

    const planModeAdditions = getPlanModeSystemPromptAdditions(
      messages as any[],
      toolUseContext,
    )
    if (planModeAdditions.length > 0) {
      fullSystemPrompt.push(...planModeAdditions)
    }

    const hookAdditions = drainHookSystemPromptAdditions(toolUseContext)
    if (hookAdditions.length > 0) {
      fullSystemPrompt.push(...hookAdditions)
    }

    if (toolUseContext.agentId === 'main') {
      const outputStyleAdditions = getOutputStyleSystemPromptAdditions()
      if (outputStyleAdditions.length > 0) {
        fullSystemPrompt.push(...outputStyleAdditions)
      }
    }

    emitReminderEvent('session:startup', {
      agentId: toolUseContext.agentId,
      messages: messages.length,
      timestamp: Date.now(),
    })

    // Inject reminders into last user message
    if (reminders && messages.length > 0) {
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i]
        if (msg?.type === 'user') {
          const lastUserMessage = msg as UserMessage
          messages[i] = {
            ...lastUserMessage,
            message: {
              ...lastUserMessage.message,
              content:
                typeof lastUserMessage.message.content === 'string'
                  ? reminders + lastUserMessage.message.content
                  : [
                      ...(Array.isArray(lastUserMessage.message.content)
                        ? lastUserMessage.message.content
                        : []),
                      { type: 'text', text: reminders },
                    ],
            },
          }
          break
        }
      }
    }

    // ========================================================================
    // Phase 3: Query LLM
    // ========================================================================

    markPhase('LLM_PREPARATION')

    function getAssistantResponse() {
      return queryLLM(
        normalizeMessagesForAPI(messages),
        fullSystemPrompt,
        toolUseContext.options.maxThinkingTokens,
        toolUseContext.options.tools,
        toolUseContext.abortController.signal,
        {
          safeMode: toolUseContext.options.safeMode ?? false,
          model: toolUseContext.options.model || 'main',
          prependCLISysprompt: true,
          toolUseContext: toolUseContext,
        },
      )
    }

    const result = await queryWithBinaryFeedback(
      toolUseContext,
      getAssistantResponse,
      getBinaryFeedbackResponse,
    )

    if (toolUseContext.abortController.signal.aborted) {
      yield createAssistantMessage(INTERRUPT_MESSAGE)
      return
    }

    if (result.message === null) {
      yield createAssistantMessage(INTERRUPT_MESSAGE)
      return
    }

    const assistantMessage = result.message
    const shouldSkipPermissionCheck = result.shouldSkipPermissionCheck

    // ========================================================================
    // Phase 4: Handle Response
    // ========================================================================

    const toolUseMessages =
      assistantMessage.message.content.filter(isToolUseLikeBlock)

    // No tool calls - end turn
    if (!toolUseMessages.length) {
      const stopHookEvent =
        toolUseContext.agentId && toolUseContext.agentId !== 'main'
          ? ('SubagentStop' as const)
          : ('Stop' as const)
      const stopReason =
        (assistantMessage.message as any)?.stop_reason ||
        (assistantMessage.message as any)?.stopReason ||
        'end_turn'

      const stopOutcome = await runStopHooks({
        hookEvent: stopHookEvent,
        reason: String(stopReason ?? ''),
        agentId: toolUseContext.agentId,
        permissionMode: toolUseContext.options?.toolPermissionContext?.mode,
        cwd: getCwd(),
        transcriptPath: getHookTranscriptPath(toolUseContext),
        safeMode: toolUseContext.options?.safeMode ?? false,
        stopHookActive,
        signal: toolUseContext.abortController.signal,
      })

      if (stopOutcome.systemMessages.length > 0) {
        queueHookSystemMessages(toolUseContext, stopOutcome.systemMessages)
      }
      if (stopOutcome.additionalContexts.length > 0) {
        queueHookAdditionalContexts(
          toolUseContext,
          stopOutcome.additionalContexts,
        )
      }

      if (stopOutcome.decision === 'block') {
        queueHookSystemMessages(toolUseContext, [stopOutcome.message])
        const MAX_STOP_HOOK_ATTEMPTS = 5
        if (stopHookAttempts < MAX_STOP_HOOK_ATTEMPTS) {
          yield* await queryCore(
            [...messages, assistantMessage],
            systemPrompt,
            context,
            canUseTool,
            toolUseContext,
            getBinaryFeedbackResponse,
            {
              stopHookActive: true,
              stopHookAttempts: stopHookAttempts + 1,
            },
          )
          return
        }
      }

      yield assistantMessage
      return
    }

    // ========================================================================
    // Phase 5: Execute Tools
    // ========================================================================

    yield assistantMessage
    const siblingToolUseIDs = new Set<string>(toolUseMessages.map(_ => _.id))
    const toolQueue = new ToolUseQueue({
      toolDefinitions: toolUseContext.options.tools,
      canUseTool,
      toolUseContext,
      siblingToolUseIDs,
      shouldSkipPermissionCheck,
    })

    for (const toolUse of toolUseMessages) {
      toolQueue.addTool(toolUse, assistantMessage)
    }

    const toolMessagesForNextTurn: (UserMessage | AssistantMessage)[] = []
    for await (const message of toolQueue.getRemainingResults()) {
      yield message
      if (message.type !== 'progress') {
        toolMessagesForNextTurn.push(message as UserMessage | AssistantMessage)
      }
    }

    toolUseContext = toolQueue.getUpdatedContext()

    if (toolUseContext.abortController.signal.aborted) {
      yield createAssistantMessage(INTERRUPT_MESSAGE_FOR_TOOL_USE)
      return
    }

    // ========================================================================
    // Phase 6: Recursive Continue
    // ========================================================================

    try {
      yield* await queryCore(
        [...messages, assistantMessage, ...toolMessagesForNextTurn],
        systemPrompt,
        context,
        canUseTool,
        toolUseContext,
        getBinaryFeedbackResponse,
        hookState,
      )
    } catch (error) {
      throw error
    }
  } finally {
    setRequestStatus({ kind: 'idle' })
  }
}
