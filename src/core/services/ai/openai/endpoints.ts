import type { OpenAI } from 'openai'
import { fetch, Response } from 'undici'
import { debug as debugLogger } from '@utils/log/debugLogger'

export async function tryWithEndpointFallback(
  baseURL: string,
  opts: OpenAI.ChatCompletionCreateParams,
  headers: Record<string, string>,
  provider: string,
  proxy: any,
  signal?: AbortSignal,
): Promise<{ response: Response; endpoint: string }> {
  const endpointsToTry = []

  if (provider === 'minimax') {
    endpointsToTry.push('/text/chatcompletion_v2', '/chat/completions')
  } else {
    endpointsToTry.push('/chat/completions')
  }

  let lastError = null

  for (const endpoint of endpointsToTry) {
    try {
      const response = await fetch(`${baseURL}${endpoint}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(opts.stream ? { ...opts, stream: true } : opts),
        dispatcher: proxy,
        signal: signal,
      })

      if (response.ok) {
        return { response, endpoint }
      }

      if (response.status === 404 && endpointsToTry.length > 1) {
        debugLogger.api('OPENAI_ENDPOINT_FALLBACK', {
          endpoint,
          status: 404,
          reason: 'not_found',
        })
        continue
      }

      return { response, endpoint }
    } catch (error) {
      lastError = error
      if (endpointsToTry.indexOf(endpoint) < endpointsToTry.length - 1) {
        debugLogger.api('OPENAI_ENDPOINT_FALLBACK', {
          endpoint,
          reason: 'network_error',
          error: error instanceof Error ? error.message : String(error),
        })
        continue
      }
    }
  }

  throw lastError || new Error('All endpoints failed')
}
