import '@anthropic-ai/sdk/shims/node'
import Anthropic from '@anthropic-ai/sdk'
import { AnthropicBedrock } from '@anthropic-ai/bedrock-sdk'
import { AnthropicVertex } from '@anthropic-ai/vertex-sdk'
import type {
  MessageParam,
  TextBlockParam,
} from '@anthropic-ai/sdk/resources/index.mjs'
import { ContentBlock } from '@anthropic-ai/sdk/resources/messages/messages'
import chalk from 'chalk'
import { nanoid } from 'nanoid'
import type { UUID } from 'crypto'

import { addToTotalCost } from '@costTracker'
import models from '@constants/models'
import type { AssistantMessage, UserMessage } from '@query'
import { Tool, getToolDescription } from '@tool'
import {
  getAnthropicApiKey,
  getGlobalConfig,
  ModelProfile,
} from '@utils/config'
import { logError } from '@utils/log'
import { USER_AGENT } from '@utils/system/http'
import { setRequestStatus } from '@utils/session/requestStatus'
import {
  debug as debugLogger,
  getCurrentRequest,
  logLLMInteraction,
  logSystemPromptConstruction,
} from '@utils/log/debugLogger'
import { getModelManager, USE_BEDROCK, USE_VERTEX } from '@utils/model'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { parseToolUsePartialJsonOrThrow } from '@utils/tooling/toolUsePartialJson'
import { getCLISyspromptPrefix } from '@constants/prompts'
import { getVertexRegionForModel } from '@utils/model'
import type { ToolUseContext } from '@tool'
import { generateKodeContext } from '@services/kodeContext'
import { MAIN_QUERY_TEMPERATURE } from '../llmConstants'

import { withRetry } from './retry'
import {
  addCacheBreakpoints,
  applyCacheControlWithLimits,
  splitSysPromptPrefix,
} from './prompt'
import { getAssistantMessageFromError, getMaxTokensFromProfile } from './shared'

export async function fetchAnthropicModels(
  baseURL: string,
  apiKey: string,
): Promise<any[]> {
  try {
    const modelsURL = baseURL
      ? `${baseURL.replace(/\/+$/, '')}/v1/models`
      : 'https://api.anthropic.com/v1/models'

    const response = await fetch(modelsURL, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'User-Agent': USER_AGENT,
      },
    })

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error(
          'Invalid API key. Please check your Anthropic API key and try again.',
        )
      } else if (response.status === 403) {
        throw new Error(
          'API key does not have permission to access models. Please check your API key permissions.',
        )
      } else if (response.status === 429) {
        throw new Error(
          'Too many requests. Please wait a moment and try again.',
        )
      } else if (response.status >= 500) {
        throw new Error(
          'Anthropic service is temporarily unavailable. Please try again later.',
        )
      } else {
        throw new Error(
          `Unable to connect to Anthropic API (${response.status}). Please check your internet connection and API key.`,
        )
      }
    }

    const data = await response.json()
    return data.data || []
  } catch (error) {
    if (
      (error instanceof Error && error.message.includes('API key')) ||
      (error instanceof Error && error.message.includes('Anthropic'))
    ) {
      throw error
    }

    logError(error)
    debugLogger.warn('ANTHROPIC_MODELS_FETCH_FAILED', {
      error: error instanceof Error ? error.message : String(error),
    })
    throw new Error(
      'Unable to connect to Anthropic API. Please check your internet connection and try again.',
    )
  }
}

export async function verifyApiKey(
  apiKey: string,
  baseURL?: string,
  provider?: string,
): Promise<boolean> {
  if (!apiKey) {
    return false
  }

  if (provider && provider !== 'anthropic') {
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      }

      if (!baseURL) {
        debugLogger.warn('API_VERIFICATION_MISSING_BASE_URL', { provider })
        return false
      }

      const modelsURL = `${baseURL.replace(/\/+$/, '')}/models`

      const response = await fetch(modelsURL, {
        method: 'GET',
        headers,
      })

      return response.ok
    } catch (error) {
      logError(error)
      debugLogger.warn('API_VERIFICATION_FAILED', {
        provider,
        error: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }

  const clientConfig: any = {
    apiKey,
    dangerouslyAllowBrowser: true,
    maxRetries: 3,
    defaultHeaders: {
      'User-Agent': USER_AGENT,
    },
  }

  if (baseURL && (provider === 'anthropic' || provider === 'minimax-coding')) {
    clientConfig.baseURL = baseURL
  }

  const anthropic = new Anthropic(clientConfig)

  try {
    await withRetry(
      async () => {
        const model = 'claude-sonnet-4-20250514'
        const messages: MessageParam[] = [{ role: 'user', content: 'test' }]
        await anthropic.messages.create({
          model,
          max_tokens: 1000,
          messages,
          temperature: 0,
        })
        return true
      },
      { maxRetries: 2 },
    )
    return true
  } catch (error) {
    logError(error)
    if (
      error instanceof Error &&
      error.message.includes(
        '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
      )
    ) {
      return false
    }
    throw error
  }
}

let anthropicClient: Anthropic | AnthropicBedrock | AnthropicVertex | null =
  null

export function getAnthropicClient(
  model?: string,
): Anthropic | AnthropicBedrock | AnthropicVertex {
  const config = getGlobalConfig()
  const provider = config.primaryProvider

  if (anthropicClient && provider) {
    anthropicClient = null
  }

  if (anthropicClient) {
    return anthropicClient
  }

  const region = getVertexRegionForModel(model)

  const modelManager = getModelManager()
  const modelProfile = modelManager.getModel('main')

  const defaultHeaders: { [key: string]: string } = {
    'x-app': 'cli',
    'User-Agent': USER_AGENT,
  }

  if (process.env.ANTHROPIC_AUTH_TOKEN) {
    defaultHeaders['Authorization'] =
      `Bearer ${process.env.ANTHROPIC_AUTH_TOKEN}`
  }

  const ARGS = {
    defaultHeaders,
    maxRetries: 0,
    timeout: parseInt(process.env.API_TIMEOUT_MS || String(60 * 1000), 10),
  }
  if (USE_BEDROCK) {
    const client = new AnthropicBedrock(ARGS)
    anthropicClient = client
    return client
  }
  if (USE_VERTEX) {
    const vertexArgs = {
      ...ARGS,
      region: region || process.env.CLOUD_ML_REGION || 'us-east5',
    }
    const client = new AnthropicVertex(vertexArgs)
    anthropicClient = client
    return client
  }

  let apiKey: string
  let baseURL: string | undefined

  if (modelProfile) {
    apiKey = modelProfile.apiKey || ''
    baseURL = modelProfile.baseURL
  } else {
    apiKey = getAnthropicApiKey()
    baseURL = undefined
  }

  if (process.env.USER_TYPE === 'ant' && !apiKey && provider === 'anthropic') {
    console.error(
      chalk.red(
        '[ANT-ONLY] Missing API key. Configure an API key in your model profile or environment variables.',
      ),
    )
  }

  const clientConfig = {
    apiKey,
    dangerouslyAllowBrowser: true,
    ...ARGS,
    ...(baseURL && { baseURL }),
  }

  anthropicClient = new Anthropic(clientConfig)
  return anthropicClient
}

export function resetAnthropicClient(): void {
  anthropicClient = null
}

export async function queryAnthropicNative(
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
  let anthropic: Anthropic | AnthropicBedrock | AnthropicVertex
  let model: string
  let provider: string

  debugLogger.api('MODEL_CONFIG_ANTHROPIC', {
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
    provider = modelProfile.provider || config.primaryProvider || 'anthropic'

    if (
      modelProfile.provider === 'anthropic' ||
      modelProfile.provider === 'minimax-coding'
    ) {
      const clientConfig: any = {
        apiKey: modelProfile.apiKey,
        dangerouslyAllowBrowser: true,
        maxRetries: 0,
        timeout: parseInt(process.env.API_TIMEOUT_MS || String(60 * 1000), 10),
        defaultHeaders: {
          'x-app': 'cli',
          'User-Agent': USER_AGENT,
        },
      }

      if (modelProfile.baseURL) {
        clientConfig.baseURL = modelProfile.baseURL
      }

      anthropic = new Anthropic(clientConfig)
    } else {
      anthropic = getAnthropicClient(model)
    }
  } else {
    const errorDetails = {
      modelProfileExists: !!modelProfile,
      modelProfileModelName: modelProfile?.modelName,
      requestedModel: options?.model,
      requestId: getCurrentRequest()?.id,
    }
    debugLogger.error('ANTHROPIC_FALLBACK_ERROR', errorDetails)
    throw new Error(
      `No valid ModelProfile available for Anthropic provider. Please configure model through /model command. Debug: ${JSON.stringify(errorDetails)}`,
    )
  }

  if (options?.prependCLISysprompt) {
    systemPrompt = [getCLISyspromptPrefix(), ...systemPrompt]
  }

  const system: TextBlockParam[] = splitSysPromptPrefix(systemPrompt).map(
    _ => ({
      text: _,
      type: 'text',
    }),
  )

  const toolSchemas = await Promise.all(
    tools.map(
      async tool =>
        ({
          name: tool.name,
          description: getToolDescription(tool),
          input_schema:
            'inputJSONSchema' in tool && tool.inputJSONSchema
              ? tool.inputJSONSchema
              : (zodToJsonSchema(tool.inputSchema as any) as any),
        }) as unknown as Anthropic.Beta.Messages.BetaTool,
    ),
  )

  const anthropicMessages = addCacheBreakpoints(messages)

  const { systemBlocks: processedSystem, messageParams: processedMessages } =
    applyCacheControlWithLimits(system, anthropicMessages)
  const startIncludingRetries = Date.now()

  logSystemPromptConstruction({
    basePrompt: systemPrompt.join('\n'),
    kodeContext: generateKodeContext() || '',
    reminders: [],
    finalPrompt: systemPrompt.join('\n'),
  })

  let start = Date.now()
  let attemptNumber = 0
  let response
  let requestPayload: any = null

  try {
    response = await withRetry(
      async attempt => {
        attemptNumber = attempt
        start = Date.now()

        const params: Anthropic.Beta.Messages.MessageCreateParams = {
          model,
          max_tokens:
            options?.maxTokens ?? getMaxTokensFromProfile(modelProfile),
          messages: processedMessages,
          system: processedSystem,
          tools: toolSchemas.length > 0 ? toolSchemas : undefined,
          tool_choice: toolSchemas.length > 0 ? { type: 'auto' } : undefined,
          ...(options?.temperature !== undefined
            ? { temperature: options.temperature }
            : {}),
          ...(options?.stopSequences && options.stopSequences.length > 0
            ? { stop_sequences: options.stopSequences }
            : {}),
        }

        if (maxThinkingTokens > 0) {
          ;(params as any).extra_headers = {
            'anthropic-beta': 'max-tokens-3-5-sonnet-2024-07-15',
          }
          ;(params as any).thinking = { max_tokens: maxThinkingTokens }
        }
        requestPayload = config.stream ? { ...params, stream: true } : params

        debugLogger.api('ANTHROPIC_API_CALL_START_STREAMING', {
          endpoint: modelProfile?.baseURL || 'DEFAULT_ANTHROPIC',
          model,
          provider,
          apiKeyConfigured: !!modelProfile?.apiKey,
          apiKeyPrefix: modelProfile?.apiKey
            ? modelProfile.apiKey.substring(0, 8)
            : null,
          maxTokens: params.max_tokens,
          temperature: options?.temperature ?? MAIN_QUERY_TEMPERATURE,
          params: params,
          messageCount: params.messages?.length || 0,
          streamMode: true,
          toolsCount: toolSchemas.length,
          thinkingTokens: maxThinkingTokens,
          timestamp: new Date().toISOString(),
          modelProfileId: modelProfile?.modelName,
          modelProfileName: modelProfile?.name,
        })

        if (config.stream) {
          const stream = await anthropic.beta.messages.create(
            {
              ...params,
              stream: true,
            },
            {
              signal: signal,
            },
          )

          let finalResponse: any | null = null
          let messageStartEvent: any = null
          const contentBlocks: any[] = []
          const inputJSONBuffers = new Map<number, string>()
          let usage: any = null
          let stopReason: string | null = null
          let stopSequence: string | null = null
          let hasMarkedStreaming = false

          for await (const event of stream) {
            if (signal.aborted) {
              debugLogger.flow('STREAM_ABORTED', {
                eventType: event.type,
                timestamp: Date.now(),
              })
              throw new Error('Request was cancelled')
            }

            switch (event.type) {
              case 'message_start':
                messageStartEvent = event
                finalResponse = {
                  ...event.message,
                  content: [],
                }
                break

              case 'content_block_start':
                contentBlocks[event.index] = { ...event.content_block }
                const contentBlockType = (event.content_block as any).type
                if (
                  contentBlockType === 'tool_use' ||
                  contentBlockType === 'server_tool_use' ||
                  contentBlockType === 'mcp_tool_use'
                ) {
                  setRequestStatus({
                    kind: 'tool',
                    detail: (event.content_block as any).name,
                  })
                  inputJSONBuffers.set(event.index, '')
                }
                break

              case 'content_block_delta':
                const blockIndex = event.index

                if (!contentBlocks[blockIndex]) {
                  contentBlocks[blockIndex] = {
                    type:
                      event.delta.type === 'text_delta' ? 'text' : 'tool_use',
                    text: event.delta.type === 'text_delta' ? '' : undefined,
                  }
                  if (event.delta.type === 'input_json_delta') {
                    inputJSONBuffers.set(blockIndex, '')
                  }
                }

                if (event.delta.type === 'text_delta') {
                  if (!hasMarkedStreaming) {
                    setRequestStatus({ kind: 'streaming' })
                    hasMarkedStreaming = true
                  }
                  contentBlocks[blockIndex].text += event.delta.text
                } else if (event.delta.type === 'input_json_delta') {
                  const currentBuffer = inputJSONBuffers.get(blockIndex) || ''
                  const nextBuffer = currentBuffer + event.delta.partial_json
                  inputJSONBuffers.set(blockIndex, nextBuffer)

                  const trimmed = nextBuffer.trim()
                  if (trimmed.length === 0) {
                    contentBlocks[blockIndex].input = {}
                    break
                  }

                  contentBlocks[blockIndex].input =
                    parseToolUsePartialJsonOrThrow(nextBuffer) ?? {}
                }
                break

              case 'message_delta':
                if (event.delta.stop_reason)
                  stopReason = event.delta.stop_reason
                if (event.delta.stop_sequence)
                  stopSequence = event.delta.stop_sequence
                if (event.usage) usage = { ...usage, ...event.usage }
                break

              case 'content_block_stop':
                const stopIndex = event.index
                const block = contentBlocks[stopIndex]

                if (
                  (block?.type === 'tool_use' ||
                    block?.type === 'server_tool_use' ||
                    block?.type === 'mcp_tool_use') &&
                  inputJSONBuffers.has(stopIndex)
                ) {
                  const jsonStr = inputJSONBuffers.get(stopIndex) ?? ''
                  if (block.input === undefined) {
                    const trimmed = jsonStr.trim()
                    if (trimmed.length === 0) {
                      block.input = {}
                    } else {
                      block.input =
                        parseToolUsePartialJsonOrThrow(jsonStr) ?? {}
                    }
                  }

                  inputJSONBuffers.delete(stopIndex)
                }
                break

              case 'message_stop':
                inputJSONBuffers.clear()
                break
            }

            if (event.type === 'message_stop') {
              break
            }
          }

          if (!finalResponse || !messageStartEvent) {
            throw new Error('Stream ended without proper message structure')
          }

          finalResponse = {
            ...messageStartEvent.message,
            content: contentBlocks.filter(Boolean),
            stop_reason: stopReason,
            stop_sequence: stopSequence,
            usage: {
              ...messageStartEvent.message.usage,
              ...usage,
            },
          }

          return finalResponse
        } else {
          debugLogger.api('ANTHROPIC_API_CALL_START_NON_STREAMING', {
            endpoint: modelProfile?.baseURL || 'DEFAULT_ANTHROPIC',
            model,
            provider,
            apiKeyConfigured: !!modelProfile?.apiKey,
            apiKeyPrefix: modelProfile?.apiKey
              ? modelProfile.apiKey.substring(0, 8)
              : null,
            maxTokens: params.max_tokens,
            temperature: options?.temperature ?? MAIN_QUERY_TEMPERATURE,
            messageCount: params.messages?.length || 0,
            streamMode: false,
            toolsCount: toolSchemas.length,
            thinkingTokens: maxThinkingTokens,
            timestamp: new Date().toISOString(),
            modelProfileId: modelProfile?.modelName,
            modelProfileName: modelProfile?.name,
          })

          return await anthropic.beta.messages.create(params, {
            signal: signal,
          })
        }
      },
      { signal },
    )

    debugLogger.api('ANTHROPIC_API_CALL_SUCCESS', {
      content: response.content,
    })

    const durationMs = Date.now() - startIncludingRetries

    const content = response.content.map((block: ContentBlock) => {
      if (block.type === 'text') {
        return {
          type: 'text' as const,
          text: block.text,
        }
      } else if (block.type === 'tool_use') {
        return {
          type: 'tool_use' as const,
          id: block.id,
          name: block.name,
          input: block.input,
        }
      }
      return block
    })

    const assistantMessage: AssistantMessage = {
      message: {
        id: response.id,
        content,
        model: response.model,
        role: 'assistant',
        stop_reason: response.stop_reason,
        stop_sequence: response.stop_sequence,
        type: 'message',
        usage: response.usage,
      },
      type: 'assistant',
      uuid: nanoid() as UUID,
      durationMs,
      costUSD: 0,
    }

    const systemMessages = system.map(block => ({
      role: 'system',
      content: block.text,
    }))

    logLLMInteraction({
      systemPrompt: systemPrompt.join('\n'),
      messages: [...systemMessages, ...anthropicMessages],
      request: requestPayload,
      response: response,
      usage: response.usage
        ? {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
          }
        : undefined,
      timing: {
        start: start,
        end: Date.now(),
      },
      apiFormat: 'anthropic',
    })

    const inputTokens = response.usage.input_tokens
    const outputTokens = response.usage.output_tokens
    const cacheCreationInputTokens =
      response.usage.cache_creation_input_tokens ?? 0
    const cacheReadInputTokens = response.usage.cache_read_input_tokens ?? 0

    const costUSD =
      (inputTokens / 1_000_000) * getModelInputTokenCostUSD(model) +
      (outputTokens / 1_000_000) * getModelOutputTokenCostUSD(model) +
      (cacheCreationInputTokens / 1_000_000) *
        getModelInputTokenCostUSD(model) +
      (cacheReadInputTokens / 1_000_000) *
        (getModelInputTokenCostUSD(model) * 0.1)

    assistantMessage.costUSD = costUSD
    addToTotalCost(costUSD, durationMs)

    return assistantMessage
  } catch (error) {
    return getAssistantMessageFromError(error)
  }
}

function getModelInputTokenCostUSD(model: string): number {
  for (const providerModels of Object.values(models)) {
    const modelInfo = providerModels.find((m: any) => m.model === model)
    if (modelInfo) {
      return modelInfo.input_cost_per_token || 0
    }
  }
  return 0.000003
}

function getModelOutputTokenCostUSD(model: string): number {
  for (const providerModels of Object.values(models)) {
    const modelInfo = providerModels.find((m: any) => m.model === model)
    if (modelInfo) {
      return modelInfo.output_cost_per_token || 0
    }
  }
  return 0.000015
}
