import { randomUUID } from 'crypto'

import type { AssistantMessage, UserMessage } from '@query'
import type { Tool } from '@tool'
import { getGlobalConfig } from '@utils/config'
import type { ModelProfile } from '@utils/config'
import { withVCR } from '@services/vcr'
import {
  debug as debugLogger,
  getCurrentRequest,
  logErrorWithDiagnosis,
  markPhase,
} from '@utils/log/debugLogger'
import { getModelManager } from '@utils/model'
import type { ToolUseContext } from '@tool'
import {
  responseStateManager,
  getConversationId,
} from '../responseStateManager'

import { queryAnthropicNative } from './anthropic'
import { queryOpenAI } from './openaiQuery'

export async function queryLLM(
  messages: (UserMessage | AssistantMessage)[],
  systemPrompt: string[],
  maxThinkingTokens: number,
  tools: Tool[],
  signal: AbortSignal,
  options: {
    safeMode: boolean
    model: string | import('@utils/config').ModelPointerType
    prependCLISysprompt: boolean
    temperature?: number
    maxTokens?: number
    stopSequences?: string[]
    toolUseContext?: ToolUseContext
    logTag?: string
    __testModelManager?: any
    __testQueryLLMWithPromptCaching?: any
  },
): Promise<AssistantMessage> {
  const modelManager = options.__testModelManager ?? getModelManager()
  const modelResolution = modelManager.resolveModelWithInfo(options.model)

  if (!modelResolution.success || !modelResolution.profile) {
    const fallbackProfile = modelManager.resolveModel(options.model)
    if (!fallbackProfile) {
      throw new Error(
        modelResolution.error || `Failed to resolve model: ${options.model}`,
      )
    }

    debugLogger.warn('MODEL_RESOLUTION_FALLBACK', {
      inputParam: options.model,
      error: modelResolution.error,
      fallbackModelName: fallbackProfile.modelName,
      fallbackProvider: fallbackProfile.provider,
      requestId: getCurrentRequest()?.id,
    })

    modelResolution.success = true
    modelResolution.profile = fallbackProfile
  }

  const modelProfile = modelResolution.profile
  const resolvedModel = modelProfile.modelName

  const toolUseContext = options.toolUseContext
  if (toolUseContext && !toolUseContext.responseState) {
    const conversationId = getConversationId(
      toolUseContext.agentId,
      toolUseContext.messageId,
    )
    const previousResponseId =
      responseStateManager.getPreviousResponseId(conversationId)

    toolUseContext.responseState = {
      previousResponseId,
      conversationId,
    }
  }

  debugLogger.api('MODEL_RESOLVED', {
    inputParam: options.model,
    resolvedModelName: resolvedModel,
    provider: modelProfile.provider,
    isPointer: ['main', 'task', 'compact', 'quick'].includes(options.model),
    hasResponseState: !!toolUseContext?.responseState,
    conversationId: toolUseContext?.responseState?.conversationId,
    requestId: getCurrentRequest()?.id,
  })

  const currentRequest = getCurrentRequest()
  debugLogger.api('LLM_REQUEST_START', {
    messageCount: messages.length,
    systemPromptLength: systemPrompt.join(' ').length,
    toolCount: tools.length,
    model: resolvedModel,
    originalModelParam: options.model,
    requestId: getCurrentRequest()?.id,
  })

  markPhase('LLM_CALL')

  try {
    const queryFn =
      options.__testQueryLLMWithPromptCaching ?? queryLLMWithPromptCaching
    const cleanOptions: any = { ...options }
    delete cleanOptions.__testModelManager
    delete cleanOptions.__testQueryLLMWithPromptCaching

    const runQuery = () =>
      queryFn(messages, systemPrompt, maxThinkingTokens, tools, signal, {
        ...cleanOptions,
        model: resolvedModel,
        modelProfile,
        toolUseContext,
      })

    const result = options.__testQueryLLMWithPromptCaching
      ? await runQuery()
      : await withVCR(messages, runQuery)

    debugLogger.api('LLM_REQUEST_SUCCESS', {
      costUSD: result.costUSD,
      durationMs: result.durationMs,
      responseLength: result.message.content?.length || 0,
      requestId: getCurrentRequest()?.id,
    })

    if (toolUseContext?.responseState?.conversationId && result.responseId) {
      responseStateManager.setPreviousResponseId(
        toolUseContext.responseState.conversationId,
        result.responseId,
      )

      debugLogger.api('RESPONSE_STATE_UPDATED', {
        conversationId: toolUseContext.responseState.conversationId,
        responseId: result.responseId,
        requestId: getCurrentRequest()?.id,
      })
    }

    return result
  } catch (error) {
    logErrorWithDiagnosis(
      error,
      {
        messageCount: messages.length,
        systemPromptLength: systemPrompt.join(' ').length,
        model: options.model,
        toolCount: tools.length,
        phase: 'LLM_CALL',
      },
      currentRequest?.id,
    )

    throw error
  }
}

export async function queryLLMWithPromptCaching(
  messages: (UserMessage | AssistantMessage)[],
  systemPrompt: string[],
  maxThinkingTokens: number,
  tools: Tool[],
  signal: AbortSignal,
  options: {
    safeMode: boolean
    model: string
    prependCLISysprompt: boolean
    temperature?: number
    maxTokens?: number
    stopSequences?: string[]
    modelProfile?: ModelProfile | null
    toolUseContext?: ToolUseContext
    logTag?: string
  },
): Promise<AssistantMessage> {
  const config = getGlobalConfig()
  const modelManager = getModelManager()
  const toolUseContext = options.toolUseContext

  const modelProfile = options.modelProfile || modelManager.getModel('main')
  let provider: string

  if (modelProfile) {
    provider = modelProfile.provider || config.primaryProvider || 'anthropic'
  } else {
    provider = config.primaryProvider || 'anthropic'
  }

  if (
    provider === 'anthropic' ||
    provider === 'bigdream' ||
    provider === 'opendev' ||
    provider === 'minimax-coding'
  ) {
    return queryAnthropicNative(
      messages,
      systemPrompt,
      maxThinkingTokens,
      tools,
      signal,
      { ...options, modelProfile, toolUseContext },
    )
  }

  return queryOpenAI(messages, systemPrompt, maxThinkingTokens, tools, signal, {
    ...options,
    modelProfile,
    toolUseContext,
  })
}

export async function queryModel(
  modelPointer: import('@utils/config').ModelPointerType,
  messages: (UserMessage | AssistantMessage)[],
  systemPrompt: string[] = [],
  signal?: AbortSignal,
  options?: { logTag?: string },
): Promise<AssistantMessage> {
  return queryLLM(
    messages,
    systemPrompt,
    0,
    [],
    signal || new AbortController().signal,
    {
      safeMode: false,
      model: modelPointer,
      prependCLISysprompt: true,
      logTag: options?.logTag,
    },
  )
}

export async function queryQuick({
  systemPrompt = [],
  userPrompt,
  assistantPrompt,
  enablePromptCaching = false,
  signal,
  logTag,
}: {
  systemPrompt?: string[]
  userPrompt: string
  assistantPrompt?: string
  enablePromptCaching?: boolean
  signal?: AbortSignal
  logTag?: string
}): Promise<AssistantMessage> {
  const messages = [
    {
      message: { role: 'user', content: userPrompt },
      type: 'user',
      uuid: randomUUID(),
    },
  ] as (UserMessage | AssistantMessage)[]

  return queryModel('quick', messages, systemPrompt, signal, { logTag })
}
