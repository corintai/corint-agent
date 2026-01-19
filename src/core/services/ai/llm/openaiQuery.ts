import OpenAI from 'openai'
import type { ChatCompletionStream } from 'openai/lib/ChatCompletionStream'
import { ContentBlock } from '@anthropic-ai/sdk/resources/messages/messages'
import { nanoid } from 'nanoid'
import { randomUUID, UUID } from 'crypto'
import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'

import { addToTotalCost } from '@costTracker'
import type { AssistantMessage, UserMessage } from '@query'
import type { Tool } from '@tool'
import { getGlobalConfig } from '@utils/config'
import type { ModelProfile } from '@utils/config'
import { logError } from '@utils/log'
import {
  debug as debugLogger,
  getCurrentRequest,
  logLLMInteraction,
  logSystemPromptConstruction,
} from '@utils/log/debugLogger'
import { getModelManager } from '@utils/model'
import { getReasoningEffort } from '@utils/model/thinking'
import { normalizeContentFromAPI } from '@utils/messages'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { ToolUseContext } from '@tool'
import { getCLISyspromptPrefix } from '@constants/prompts'

import { ModelAdapterFactory } from '../modelAdapterFactory'
import { UnifiedRequestParams } from '@kode-types/modelCapabilities'
import {
  getCompletionWithProfile,
  getGPT5CompletionWithProfile,
} from '../openai'
import { generateKodeContext } from '@services/kodeContext'
import { convertAnthropicMessagesToOpenAIMessages as convertAnthropicMessagesToOpenAIMessagesUtil } from '@utils/model/openaiMessageConversion'

import { PROMPT_CACHING_ENABLED, splitSysPromptPrefix } from './prompt'
import {
  getAssistantMessageFromError,
  getMaxTokensFromProfile,
  isGPT5Model,
} from './shared'
import { MAIN_QUERY_TEMPERATURE } from '../llmConstants'
import { withRetry } from './retry'

const HAIKU_COST_PER_MILLION_INPUT_TOKENS = 0.8
const HAIKU_COST_PER_MILLION_OUTPUT_TOKENS = 4
const HAIKU_COST_PER_MILLION_PROMPT_CACHE_WRITE_TOKENS = 1
const HAIKU_COST_PER_MILLION_PROMPT_CACHE_READ_TOKENS = 0.08

const SONNET_COST_PER_MILLION_INPUT_TOKENS = 3
const SONNET_COST_PER_MILLION_OUTPUT_TOKENS = 15
const SONNET_COST_PER_MILLION_PROMPT_CACHE_WRITE_TOKENS = 3.75
const SONNET_COST_PER_MILLION_PROMPT_CACHE_READ_TOKENS = 0.3

function convertAnthropicMessagesToOpenAIMessages(
  messages: (UserMessage | AssistantMessage)[],
): (
  | OpenAI.ChatCompletionMessageParam
  | OpenAI.ChatCompletionToolMessageParam
)[] {
  return convertAnthropicMessagesToOpenAIMessagesUtil(messages as any)
}

function messageReducer(
  previous: OpenAI.ChatCompletionMessage,
  item: OpenAI.ChatCompletionChunk,
): OpenAI.ChatCompletionMessage {
  const reduce = (acc: any, delta: OpenAI.ChatCompletionChunk.Choice.Delta) => {
    acc = { ...acc }
    for (const [key, value] of Object.entries(delta)) {
      if (acc[key] === undefined || acc[key] === null) {
        acc[key] = value
        if (Array.isArray(acc[key])) {
          for (const arr of acc[key]) {
            delete arr.index
          }
        }
      } else if (typeof acc[key] === 'string' && typeof value === 'string') {
        acc[key] += value
      } else if (typeof acc[key] === 'number' && typeof value === 'number') {
        acc[key] = value
      } else if (Array.isArray(acc[key]) && Array.isArray(value)) {
        const accArray = acc[key]
        for (let i = 0; i < value.length; i++) {
          const { index, ...chunkTool } = value[i]
          if (index - accArray.length > 1) {
            throw new Error(
              `Error: An array has an empty value when tool_calls are constructed. tool_calls: ${accArray}; tool: ${value}`,
            )
          }
          accArray[index] = reduce(accArray[index], chunkTool)
        }
      } else if (typeof acc[key] === 'object' && typeof value === 'object') {
        acc[key] = reduce(acc[key], value)
      }
    }
    return acc
  }

  const choice = item.choices?.[0]
  if (!choice) {
    return previous
  }
  return reduce(previous, choice.delta) as OpenAI.ChatCompletionMessage
}

async function handleMessageStream(
  stream: ChatCompletionStream,
  signal?: AbortSignal,
): Promise<OpenAI.ChatCompletion> {
  const streamStartTime = Date.now()
  let ttftMs: number | undefined
  let chunkCount = 0
  let errorCount = 0

  debugLogger.api('OPENAI_STREAM_START', {
    streamStartTime: String(streamStartTime),
  })

  let message = {} as OpenAI.ChatCompletionMessage

  let id, model, created, object, usage
  try {
    for await (const chunk of stream) {
      if (signal?.aborted) {
        debugLogger.flow('OPENAI_STREAM_ABORTED', {
          chunkCount,
          timestamp: Date.now(),
        })
        throw new Error('Request was cancelled')
      }

      chunkCount++

      try {
        if (!id) {
          id = chunk.id
          debugLogger.api('OPENAI_STREAM_ID_RECEIVED', {
            id,
            chunkNumber: String(chunkCount),
          })
        }
        if (!model) {
          model = chunk.model
          debugLogger.api('OPENAI_STREAM_MODEL_RECEIVED', {
            model,
            chunkNumber: String(chunkCount),
          })
        }
        if (!created) {
          created = chunk.created
        }
        if (!object) {
          object = chunk.object
        }
        if (!usage) {
          usage = chunk.usage
        }

        message = messageReducer(message, chunk)

        if (chunk?.choices?.[0]?.delta?.content) {
          if (!ttftMs) {
            ttftMs = Date.now() - streamStartTime
            debugLogger.api('OPENAI_STREAM_FIRST_TOKEN', {
              ttftMs: String(ttftMs),
              chunkNumber: String(chunkCount),
            })
          }
        }
      } catch (chunkError) {
        errorCount++
        debugLogger.error('OPENAI_STREAM_CHUNK_ERROR', {
          chunkNumber: String(chunkCount),
          errorMessage:
            chunkError instanceof Error
              ? chunkError.message
              : String(chunkError),
          errorType:
            chunkError instanceof Error
              ? chunkError.constructor.name
              : typeof chunkError,
        })
      }
    }

    debugLogger.api('OPENAI_STREAM_COMPLETE', {
      totalChunks: String(chunkCount),
      errorCount: String(errorCount),
      totalDuration: String(Date.now() - streamStartTime),
      ttftMs: String(ttftMs || 0),
      finalMessageId: id || 'undefined',
    })
  } catch (streamError) {
    debugLogger.error('OPENAI_STREAM_FATAL_ERROR', {
      totalChunks: String(chunkCount),
      errorCount: String(errorCount),
      errorMessage:
        streamError instanceof Error
          ? streamError.message
          : String(streamError),
      errorType:
        streamError instanceof Error
          ? streamError.constructor.name
          : typeof streamError,
    })
    throw streamError
  }
  return {
    id,
    created,
    model,
    object,
    choices: [
      {
        index: 0,
        message,
        finish_reason: 'stop',
        logprobs: undefined,
      },
    ],
    usage,
  }
}

function convertOpenAIResponseToAnthropic(
  response: OpenAI.ChatCompletion,
  tools?: Tool[],
) {
  let contentBlocks: ContentBlock[] = []
  const message = response.choices?.[0]?.message
  if (!message) {
    return {
      role: 'assistant',
      content: [],
      stop_reason: response.choices?.[0]?.finish_reason,
      type: 'message',
      usage: response.usage,
    }
  }

  if (message?.tool_calls) {
    for (const toolCall of message.tool_calls) {
      const tool = toolCall.function
      const toolName = tool?.name
      let toolArgs = {}
      try {
        toolArgs = tool?.arguments ? JSON.parse(tool.arguments) : {}
      } catch (e) {}

      contentBlocks.push({
        type: 'tool_use',
        input: toolArgs,
        name: toolName,
        id: toolCall.id?.length > 0 ? toolCall.id : nanoid(),
      })
    }
  }

  if ((message as any).reasoning) {
    contentBlocks.push({
      type: 'thinking',
      thinking: (message as any).reasoning,
      signature: '',
    })
  }

  if ((message as any).reasoning_content) {
    contentBlocks.push({
      type: 'thinking',
      thinking: (message as any).reasoning_content,
      signature: '',
    })
  }

  if (message.content) {
    contentBlocks.push({
      type: 'text',
      text: message?.content,
      citations: [],
    })
  }

  const finalMessage = {
    role: 'assistant',
    content: contentBlocks,
    stop_reason: response.choices?.[0]?.finish_reason,
    type: 'message',
    usage: response.usage,
  }

  return finalMessage
}

function buildAssistantMessageFromUnifiedResponse(
  unifiedResponse: any,
  startTime: number,
): AssistantMessage {
  const contentBlocks = [...(unifiedResponse.content || [])]

  if (unifiedResponse.toolCalls && unifiedResponse.toolCalls.length > 0) {
    for (const toolCall of unifiedResponse.toolCalls) {
      const tool = toolCall.function
      const toolName = tool?.name
      let toolArgs = {}
      try {
        toolArgs = tool?.arguments ? JSON.parse(tool.arguments) : {}
      } catch (e) {}

      contentBlocks.push({
        type: 'tool_use',
        input: toolArgs,
        name: toolName,
        id: toolCall.id?.length > 0 ? toolCall.id : nanoid(),
      })
    }
  }

  return {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: contentBlocks,
      usage: {
        input_tokens:
          unifiedResponse.usage?.promptTokens ??
          unifiedResponse.usage?.input_tokens ??
          0,
        output_tokens:
          unifiedResponse.usage?.completionTokens ??
          unifiedResponse.usage?.output_tokens ??
          0,
        prompt_tokens:
          unifiedResponse.usage?.promptTokens ??
          unifiedResponse.usage?.input_tokens ??
          0,
        completion_tokens:
          unifiedResponse.usage?.completionTokens ??
          unifiedResponse.usage?.output_tokens ??
          0,
        promptTokens:
          unifiedResponse.usage?.promptTokens ??
          unifiedResponse.usage?.input_tokens ??
          0,
        completionTokens:
          unifiedResponse.usage?.completionTokens ??
          unifiedResponse.usage?.output_tokens ??
          0,
        totalTokens:
          unifiedResponse.usage?.totalTokens ??
          (unifiedResponse.usage?.promptTokens ??
            unifiedResponse.usage?.input_tokens ??
            0) +
            (unifiedResponse.usage?.completionTokens ??
              unifiedResponse.usage?.output_tokens ??
              0),
      },
    },
    costUSD: 0,
    durationMs: Date.now() - startTime,
    uuid: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}` as any,
    responseId: unifiedResponse.responseId,
  }
}

function normalizeUsage(usage?: any) {
  if (!usage) {
    return {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    }
  }

  const inputTokens =
    usage.input_tokens ?? usage.prompt_tokens ?? usage.inputTokens ?? 0
  const outputTokens =
    usage.output_tokens ?? usage.completion_tokens ?? usage.outputTokens ?? 0
  const cacheReadInputTokens =
    usage.cache_read_input_tokens ??
    usage.prompt_token_details?.cached_tokens ??
    usage.cacheReadInputTokens ??
    0
  const cacheCreationInputTokens =
    usage.cache_creation_input_tokens ?? usage.cacheCreatedInputTokens ?? 0

  return {
    ...usage,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_input_tokens: cacheReadInputTokens,
    cache_creation_input_tokens: cacheCreationInputTokens,
  }
}

export async function queryOpenAI(
  messages: (UserMessage | AssistantMessage)[],
  systemPrompt: string[],
  maxThinkingTokens: number,
  tools: Tool[],
  signal: AbortSignal,
  options?: {
    safeMode: boolean
    model: string
    prependCLISysprompt: boolean
    temperature?: number
    maxTokens?: number
    stopSequences?: string[]
    modelProfile?: ModelProfile | null
    toolUseContext?: ToolUseContext
  },
): Promise<AssistantMessage> {
  const config = getGlobalConfig()
  const modelManager = getModelManager()
  const toolUseContext = options?.toolUseContext

  const modelProfile = options?.modelProfile || modelManager.getModel('main')
  let model: string

  debugLogger.api('MODEL_CONFIG_OPENAI', {
    modelProfileFound: !!modelProfile,
    modelProfileId: modelProfile?.modelName,
    modelProfileName: modelProfile?.name,
    modelProfileModelName: modelProfile?.modelName,
    modelProfileProvider: modelProfile?.provider,
    modelProfileBaseURL: modelProfile?.baseURL,
    modelProfileApiKeyExists: !!modelProfile?.apiKey,
    optionsModel: options?.model,
    requestId: getCurrentRequest()?.id,
  })

  if (modelProfile) {
    model = modelProfile.modelName
  } else {
    model = options?.model || modelProfile?.modelName || ''
  }
  if (options?.prependCLISysprompt) {
    splitSysPromptPrefix(systemPrompt)

    systemPrompt = [getCLISyspromptPrefix() + systemPrompt]
  }

  const system: TextBlockParam[] = splitSysPromptPrefix(systemPrompt).map(
    _ => ({
      ...(PROMPT_CACHING_ENABLED
        ? { cache_control: { type: 'ephemeral' } }
        : {}),
      text: _,
      type: 'text',
    }),
  )

  const toolSchemas = await Promise.all(
    tools.map(
      async _ =>
        ({
          type: 'function',
          function: {
            name: _.name,
            description: await _.prompt({
              safeMode: options?.safeMode,
            }),
            parameters:
              'inputJSONSchema' in _ && _.inputJSONSchema
                ? _.inputJSONSchema
                : (zodToJsonSchema(_.inputSchema as any) as any),
          },
        }) as OpenAI.ChatCompletionTool,
    ),
  )

  const openaiSystem = system.map(
    s =>
      ({
        role: 'system',
        content: s.text,
      }) as OpenAI.ChatCompletionMessageParam,
  )

  const openaiMessages = convertAnthropicMessagesToOpenAIMessages(messages)

  logSystemPromptConstruction({
    basePrompt: systemPrompt.join('\n'),
    kodeContext: generateKodeContext() || '',
    reminders: [],
    finalPrompt: systemPrompt.join('\n'),
  })

  let start = Date.now()

  type AdapterExecutionContext = {
    adapter: ReturnType<typeof ModelAdapterFactory.createAdapter>
    request: any
    shouldUseResponses: boolean
  }

  type QueryResult = {
    assistantMessage: AssistantMessage
    rawResponse?: any
    apiFormat: 'openai'
  }

  let adapterContext: AdapterExecutionContext | null = null
  let requestPayload: any = null

  if (modelProfile && modelProfile.modelName) {
    debugLogger.api('CHECKING_ADAPTER_SYSTEM', {
      modelProfileName: modelProfile.modelName,
      modelName: modelProfile.modelName,
      provider: modelProfile.provider,
      requestId: getCurrentRequest()?.id,
    })

    const USE_NEW_ADAPTER_SYSTEM = process.env.USE_NEW_ADAPTERS !== 'false'

    if (USE_NEW_ADAPTER_SYSTEM) {
      const shouldUseResponses =
        ModelAdapterFactory.shouldUseResponsesAPI(modelProfile)

      if (shouldUseResponses) {
        const adapter = ModelAdapterFactory.createAdapter(modelProfile)
        const reasoningEffort = await getReasoningEffort(modelProfile, messages)

        let verbosity: 'low' | 'medium' | 'high' = 'medium'
        const modelNameLower = modelProfile.modelName.toLowerCase()
        if (modelNameLower.includes('high')) {
          verbosity = 'high'
        } else if (modelNameLower.includes('low')) {
          verbosity = 'low'
        }

        const unifiedParams: UnifiedRequestParams = {
          messages: openaiMessages,
          systemPrompt: openaiSystem.map(s => s.content as string),
          tools,
          maxTokens:
            options?.maxTokens ?? getMaxTokensFromProfile(modelProfile),
          stream: config.stream,
          reasoningEffort: reasoningEffort as any,
          temperature:
            options?.temperature ??
            (isGPT5Model(model) ? 1 : MAIN_QUERY_TEMPERATURE),
          previousResponseId: toolUseContext?.responseState?.previousResponseId,
          verbosity,
          ...(options?.stopSequences && options.stopSequences.length > 0
            ? { stopSequences: options.stopSequences }
            : {}),
        }

        adapterContext = {
          adapter,
          request: adapter.createRequest(unifiedParams),
          shouldUseResponses: true,
        }
        requestPayload = adapterContext.request
      }
    }
  }

  let queryResult: QueryResult
  let startIncludingRetries = Date.now()

  try {
    queryResult = await withRetry(
      async () => {
        start = Date.now()

        if (adapterContext) {
          if (adapterContext.shouldUseResponses) {
            requestPayload = adapterContext.request
            const { callGPT5ResponsesAPI } = await import('../openai')

            const response = await callGPT5ResponsesAPI(
              modelProfile,
              adapterContext.request,
              signal,
            )

            const unifiedResponse =
              await adapterContext.adapter.parseResponse(response)

            const assistantMessage = buildAssistantMessageFromUnifiedResponse(
              unifiedResponse,
              start,
            )
            assistantMessage.message.usage = normalizeUsage(
              assistantMessage.message.usage,
            )

            return {
              assistantMessage,
              rawResponse: unifiedResponse,
              apiFormat: 'openai',
            }
          }

          const s = await getCompletionWithProfile(
            modelProfile,
            adapterContext.request,
            0,
            10,
            signal,
          )
          requestPayload = adapterContext.request
          let finalResponse
          if (config.stream) {
            finalResponse = await handleMessageStream(
              s as ChatCompletionStream,
              signal,
            )
          } else {
            finalResponse = s
          }

          const message = convertOpenAIResponseToAnthropic(finalResponse, tools)
          const assistantMsg: AssistantMessage = {
            type: 'assistant',
            message: message as any,
            costUSD: 0,
            durationMs: Date.now() - start,
            uuid: `${Date.now()}-${Math.random()
              .toString(36)
              .substr(2, 9)}` as any,
          }

          return {
            assistantMessage: assistantMsg,
            rawResponse: finalResponse,
            apiFormat: 'openai',
          }
        }

        const maxTokens =
          options?.maxTokens ?? getMaxTokensFromProfile(modelProfile)
        const isGPT5 = isGPT5Model(model)

        const opts: OpenAI.ChatCompletionCreateParams = {
          model,
          ...(isGPT5
            ? { max_completion_tokens: maxTokens }
            : { max_tokens: maxTokens }),
          messages: [...openaiSystem, ...openaiMessages],
          temperature:
            options?.temperature ?? (isGPT5 ? 1 : MAIN_QUERY_TEMPERATURE),
        }
        if (options?.stopSequences && options.stopSequences.length > 0) {
          ;(opts as any).stop = options.stopSequences
        }
        if (config.stream) {
          ;(opts as OpenAI.ChatCompletionCreateParams).stream = true
          opts.stream_options = {
            include_usage: true,
          }
        }

        if (toolSchemas.length > 0) {
          opts.tools = toolSchemas
          opts.tool_choice = 'auto'
        }
        const reasoningEffort = await getReasoningEffort(modelProfile, messages)
        if (reasoningEffort) {
          opts.reasoning_effort = reasoningEffort
        }
        requestPayload = opts

        const completionFunction = isGPT5Model(modelProfile?.modelName || '')
          ? getGPT5CompletionWithProfile
          : getCompletionWithProfile
        const s = await completionFunction(modelProfile, opts, 0, 10, signal)
        let finalResponse
        if (opts.stream) {
          finalResponse = await handleMessageStream(
            s as ChatCompletionStream,
            signal,
          )
        } else {
          finalResponse = s
        }
        const message = convertOpenAIResponseToAnthropic(finalResponse, tools)
        const assistantMsg: AssistantMessage = {
          type: 'assistant',
          message: message as any,
          costUSD: 0,
          durationMs: Date.now() - start,
          uuid: `${Date.now()}-${Math.random()
            .toString(36)
            .substr(2, 9)}` as any,
        }
        return {
          assistantMessage: assistantMsg,
          rawResponse: finalResponse,
          apiFormat: 'openai',
        }
      },
      { signal },
    )
  } catch (error) {
    logError(error)
    return getAssistantMessageFromError(error)
  }

  const durationMs = Date.now() - start
  const durationMsIncludingRetries = Date.now() - startIncludingRetries

  const assistantMessage = queryResult.assistantMessage
  assistantMessage.message.content = normalizeContentFromAPI(
    assistantMessage.message.content || [],
  )

  const normalizedUsage = normalizeUsage(assistantMessage.message.usage)
  assistantMessage.message.usage = normalizedUsage

  const inputTokens = normalizedUsage.input_tokens ?? 0
  const outputTokens = normalizedUsage.output_tokens ?? 0
  const cacheReadInputTokens = normalizedUsage.cache_read_input_tokens ?? 0
  const cacheCreationInputTokens =
    normalizedUsage.cache_creation_input_tokens ?? 0

  const costUSD =
    (inputTokens / 1_000_000) * SONNET_COST_PER_MILLION_INPUT_TOKENS +
    (outputTokens / 1_000_000) * SONNET_COST_PER_MILLION_OUTPUT_TOKENS +
    (cacheReadInputTokens / 1_000_000) *
      SONNET_COST_PER_MILLION_PROMPT_CACHE_READ_TOKENS +
    (cacheCreationInputTokens / 1_000_000) *
      SONNET_COST_PER_MILLION_PROMPT_CACHE_WRITE_TOKENS

  addToTotalCost(costUSD, durationMsIncludingRetries)

  logLLMInteraction({
    systemPrompt: systemPrompt.join('\n'),
    messages: [...openaiSystem, ...openaiMessages],
    request: requestPayload,
    response: assistantMessage.message || queryResult.rawResponse,
    usage: {
      inputTokens,
      outputTokens,
    },
    timing: {
      start,
      end: Date.now(),
    },
    apiFormat: queryResult.apiFormat,
  })

  assistantMessage.costUSD = costUSD
  assistantMessage.durationMs = durationMs
  assistantMessage.uuid = assistantMessage.uuid || (randomUUID() as UUID)

  return assistantMessage
}
