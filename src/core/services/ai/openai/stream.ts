import type { OpenAI } from 'openai'
import { debug as debugLogger } from '@utils/log/debugLogger'

export function createStreamProcessor(
  stream: any,
  signal?: AbortSignal,
): AsyncGenerator<OpenAI.ChatCompletionChunk, void, unknown> {
  if (!stream) {
    throw new Error('Stream is null or undefined')
  }

  return (async function* () {
    const reader = stream.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''

    try {
      while (true) {
        if (signal?.aborted) {
          break
        }

        let readResult
        try {
          readResult = await reader.read()
        } catch (e) {
          if (signal?.aborted) {
            break
          }
          debugLogger.warn('OPENAI_STREAM_READ_ERROR', {
            error: e instanceof Error ? e.message : String(e),
          })
          break
        }

        const { done, value } = readResult
        if (done) {
          break
        }

        const chunk = decoder.decode(value, { stream: true })
        buffer += chunk

        let lineEnd = buffer.indexOf('\n')
        while (lineEnd !== -1) {
          const line = buffer.substring(0, lineEnd).trim()
          buffer = buffer.substring(lineEnd + 1)

          if (line === 'data: [DONE]') {
            continue
          }

          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim()
            if (!data) continue

            try {
              const parsed = JSON.parse(data) as OpenAI.ChatCompletionChunk
              yield parsed
            } catch (e) {
              debugLogger.warn('OPENAI_STREAM_JSON_PARSE_ERROR', {
                data,
                error: e instanceof Error ? e.message : String(e),
              })
            }
          }

          lineEnd = buffer.indexOf('\n')
        }
      }

      if (buffer.trim()) {
        const lines = buffer.trim().split('\n')
        for (const line of lines) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            const data = line.slice(6).trim()
            if (!data) continue

            try {
              const parsed = JSON.parse(data) as OpenAI.ChatCompletionChunk
              yield parsed
            } catch (e) {
              debugLogger.warn('OPENAI_STREAM_FINAL_JSON_PARSE_ERROR', {
                data,
                error: e instanceof Error ? e.message : String(e),
              })
            }
          }
        }
      }
    } catch (e) {
      debugLogger.warn('OPENAI_STREAM_UNEXPECTED_ERROR', {
        error: e instanceof Error ? e.message : String(e),
      })
    } finally {
      try {
        reader.releaseLock()
      } catch (e) {
        debugLogger.warn('OPENAI_STREAM_RELEASE_LOCK_ERROR', {
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }
  })()
}

export function streamCompletion(
  stream: any,
  signal?: AbortSignal,
): AsyncGenerator<OpenAI.ChatCompletionChunk, void, unknown> {
  return createStreamProcessor(stream, signal)
}
