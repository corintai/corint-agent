import { OpenAI } from 'openai'
import { ProxyAgent, fetch, Response } from 'undici'
import { getGlobalConfig } from '@utils/config'
import { debug as debugLogger, logAPIError } from '@utils/log/debugLogger'
import { ERROR_HANDLERS, GPT5_ERROR_HANDLERS, setModelError } from './errors'
import {
  applyModelErrorFixes,
  applyModelSpecificTransformations,
} from './features'
import { tryWithEndpointFallback } from './endpoints'
import { abortableDelay, getRetryDelay } from './retry'
import { createStreamProcessor } from './stream'

export async function getCompletionWithProfile(
  modelProfile: any,
  opts: OpenAI.ChatCompletionCreateParams,
  attempt: number = 0,
  maxAttempts: number = 10,
  signal?: AbortSignal,
): Promise<OpenAI.ChatCompletion | AsyncIterable<OpenAI.ChatCompletionChunk>> {
  if (attempt >= maxAttempts) {
    throw new Error('Max attempts reached')
  }

  const provider = modelProfile?.provider || 'anthropic'
  const baseURL = modelProfile?.baseURL
  const apiKey = modelProfile?.apiKey
  const proxy = getGlobalConfig().proxy
    ? new ProxyAgent(getGlobalConfig().proxy)
    : undefined

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (apiKey) {
    if (provider === 'azure') {
      headers['api-key'] = apiKey
    } else {
      headers['Authorization'] = `Bearer ${apiKey}`
    }
  }

  applyModelSpecificTransformations(opts)
  await applyModelErrorFixes(opts, baseURL || '')

  debugLogger.api('OPENAI_API_CALL_START', {
    endpoint: baseURL || 'DEFAULT_OPENAI',
    model: opts.model,
    provider,
    apiKeyConfigured: !!apiKey,
    apiKeyPrefix: apiKey ? apiKey.substring(0, 8) : null,
    maxTokens: opts.max_tokens,
    temperature: opts.temperature,
    messageCount: opts.messages?.length || 0,
    streamMode: opts.stream,
    timestamp: new Date().toISOString(),
    modelProfileModelName: modelProfile?.modelName,
    modelProfileName: modelProfile?.name,
  })

  opts.messages = opts.messages.map(msg => {
    if (msg.role === 'tool') {
      if (Array.isArray(msg.content)) {
        return {
          ...msg,
          content:
            msg.content
              .map(c => c.text || '')
              .filter(Boolean)
              .join('\n\n') || '(empty content)',
        }
      } else if (typeof msg.content !== 'string') {
        return {
          ...msg,
          content:
            typeof msg.content === 'undefined'
              ? '(empty content)'
              : JSON.stringify(msg.content),
        }
      }
    }
    return msg
  })

  const azureApiVersion = '2024-06-01'
  let endpoint = '/chat/completions'

  if (provider === 'azure') {
    endpoint = `/chat/completions?api-version=${azureApiVersion}`
  } else if (provider === 'minimax') {
    endpoint = '/text/chatcompletion_v2'
  }

  try {
    if (opts.stream) {
      const isOpenAICompatible = [
        'minimax',
        'kimi',
        'deepseek',
        'siliconflow',
        'qwen',
        'glm',
        'glm-coding',
        'baidu-qianfan',
        'openai',
        'mistral',
        'xai',
        'groq',
        'custom-openai',
      ].includes(provider)

      let response: Response
      let usedEndpoint: string

      if (isOpenAICompatible && provider !== 'azure') {
        const result = await tryWithEndpointFallback(
          baseURL,
          opts,
          headers,
          provider,
          proxy,
          signal,
        )
        response = result.response
        usedEndpoint = result.endpoint
      } else {
        response = await fetch(`${baseURL}${endpoint}`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...opts, stream: true }),
          dispatcher: proxy,
          signal: signal,
        })
        usedEndpoint = endpoint
      }

      if (!response.ok) {
        if (signal?.aborted) {
          throw new Error('Request cancelled by user')
        }

        try {
          const errorData = await response.json()
          const hasError = (
            data: unknown,
          ): data is { error?: { message?: string }; message?: string } => {
            return typeof data === 'object' && data !== null
          }
          const errorMessage = hasError(errorData)
            ? errorData.error?.message ||
              errorData.message ||
              `HTTP ${response.status}`
            : `HTTP ${response.status}`

          const isGPT5 = opts.model.startsWith('gpt-5')
          const handlers = isGPT5
            ? [...GPT5_ERROR_HANDLERS, ...ERROR_HANDLERS]
            : ERROR_HANDLERS

          for (const handler of handlers) {
            if (handler.detect(errorMessage)) {
              debugLogger.api('OPENAI_MODEL_ERROR_DETECTED', {
                model: opts.model,
                type: handler.type,
                errorMessage,
                status: response.status,
              })

              setModelError(
                baseURL || '',
                opts.model,
                handler.type,
                errorMessage,
              )

              await handler.fix(opts)
              debugLogger.api('OPENAI_MODEL_ERROR_FIXED', {
                model: opts.model,
                type: handler.type,
              })

              return getCompletionWithProfile(
                modelProfile,
                opts,
                attempt + 1,
                maxAttempts,
                signal,
              )
            }
          }

          debugLogger.warn('OPENAI_API_ERROR_UNHANDLED', {
            model: opts.model,
            status: response.status,
            errorMessage,
          })

          logAPIError({
            model: opts.model,
            endpoint: `${baseURL}${endpoint}`,
            status: response.status,
            error: errorMessage,
            request: opts,
            response: errorData,
            provider: provider,
          })
        } catch (parseError) {
          debugLogger.warn('OPENAI_API_ERROR_PARSE_FAILED', {
            model: opts.model,
            status: response.status,
            error:
              parseError instanceof Error
                ? parseError.message
                : String(parseError),
          })

          logAPIError({
            model: opts.model,
            endpoint: `${baseURL}${endpoint}`,
            status: response.status,
            error: `Could not parse error response: ${parseError.message}`,
            request: opts,
            response: { parseError: parseError.message },
            provider: provider,
          })
        }

        const delayMs = getRetryDelay(attempt)
        debugLogger.warn('OPENAI_API_RETRY', {
          model: opts.model,
          status: response.status,
          attempt: attempt + 1,
          maxAttempts,
          delayMs,
        })
        try {
          await abortableDelay(delayMs, signal)
        } catch (error) {
          if (error.message === 'Request was aborted') {
            throw new Error('Request cancelled by user')
          }
          throw error
        }
        return getCompletionWithProfile(
          modelProfile,
          opts,
          attempt + 1,
          maxAttempts,
          signal,
        )
      }

      const stream = createStreamProcessor(response.body as any, signal)
      return stream
    }

    const isOpenAICompatible = [
      'minimax',
      'kimi',
      'deepseek',
      'siliconflow',
      'qwen',
      'glm',
      'baidu-qianfan',
      'openai',
      'mistral',
      'xai',
      'groq',
      'custom-openai',
    ].includes(provider)

    let response: Response
    let usedEndpoint: string

    if (isOpenAICompatible && provider !== 'azure') {
      const result = await tryWithEndpointFallback(
        baseURL,
        opts,
        headers,
        provider,
        proxy,
        signal,
      )
      response = result.response
      usedEndpoint = result.endpoint
    } else {
      response = await fetch(`${baseURL}${endpoint}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(opts),
        dispatcher: proxy,
        signal: signal,
      })
      usedEndpoint = endpoint
    }

    if (!response.ok) {
      if (signal?.aborted) {
        throw new Error('Request cancelled by user')
      }

      try {
        const errorData = await response.json()
        const hasError = (
          data: unknown,
        ): data is { error?: { message?: string }; message?: string } => {
          return typeof data === 'object' && data !== null
        }
        const errorMessage = hasError(errorData)
          ? errorData.error?.message ||
            errorData.message ||
            `HTTP ${response.status}`
          : `HTTP ${response.status}`

        const isGPT5 = opts.model.startsWith('gpt-5')
        const handlers = isGPT5
          ? [...GPT5_ERROR_HANDLERS, ...ERROR_HANDLERS]
          : ERROR_HANDLERS

        for (const handler of handlers) {
          if (handler.detect(errorMessage)) {
            debugLogger.api('OPENAI_MODEL_ERROR_DETECTED', {
              model: opts.model,
              type: handler.type,
              errorMessage,
              status: response.status,
            })

            setModelError(baseURL || '', opts.model, handler.type, errorMessage)

            await handler.fix(opts)
            debugLogger.api('OPENAI_MODEL_ERROR_FIXED', {
              model: opts.model,
              type: handler.type,
            })

            return getCompletionWithProfile(
              modelProfile,
              opts,
              attempt + 1,
              maxAttempts,
              signal,
            )
          }
        }

        debugLogger.warn('OPENAI_API_ERROR_UNHANDLED', {
          model: opts.model,
          status: response.status,
          errorMessage,
        })
      } catch (parseError) {
        debugLogger.warn('OPENAI_API_ERROR_PARSE_FAILED', {
          model: opts.model,
          status: response.status,
          error:
            parseError instanceof Error
              ? parseError.message
              : String(parseError),
        })
      }

      const delayMs = getRetryDelay(attempt)
      debugLogger.warn('OPENAI_API_RETRY', {
        model: opts.model,
        status: response.status,
        attempt: attempt + 1,
        maxAttempts,
        delayMs,
      })
      try {
        await abortableDelay(delayMs, signal)
      } catch (error) {
        if (error.message === 'Request was aborted') {
          throw new Error('Request cancelled by user')
        }
        throw error
      }
      return getCompletionWithProfile(
        modelProfile,
        opts,
        attempt + 1,
        maxAttempts,
        signal,
      )
    }

    const responseData = (await response.json()) as OpenAI.ChatCompletion
    return responseData
  } catch (error) {
    if (signal?.aborted) {
      throw new Error('Request cancelled by user')
    }

    if (attempt < maxAttempts) {
      if (signal?.aborted) {
        throw new Error('Request cancelled by user')
      }

      const delayMs = getRetryDelay(attempt)
      debugLogger.warn('OPENAI_NETWORK_RETRY', {
        model: opts.model,
        attempt: attempt + 1,
        maxAttempts,
        delayMs,
        error: error instanceof Error ? error.message : String(error),
      })
      try {
        await abortableDelay(delayMs, signal)
      } catch (error) {
        if (error.message === 'Request was aborted') {
          throw new Error('Request cancelled by user')
        }
        throw error
      }
      return getCompletionWithProfile(
        modelProfile,
        opts,
        attempt + 1,
        maxAttempts,
        signal,
      )
    }
    throw error
  }
}
