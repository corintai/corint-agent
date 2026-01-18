import type { OpenAI } from 'openai'
import { debug as debugLogger, getCurrentRequest } from '@utils/log/debugLogger'
import { getModelFeatures } from './features'
import { getCompletionWithProfile } from './completion'

export async function getGPT5CompletionWithProfile(
  modelProfile: any,
  opts: OpenAI.ChatCompletionCreateParams,
  attempt: number = 0,
  maxAttempts: number = 10,
  signal?: AbortSignal,
): Promise<OpenAI.ChatCompletion | AsyncIterable<OpenAI.ChatCompletionChunk>> {
  const features = getModelFeatures(opts.model)
  const isOfficialOpenAI =
    !modelProfile.baseURL || modelProfile.baseURL.includes('api.openai.com')

  if (!isOfficialOpenAI) {
    debugLogger.api('GPT5_THIRD_PARTY_PROVIDER', {
      model: opts.model,
      baseURL: modelProfile.baseURL,
      provider: modelProfile.provider,
      supportsResponsesAPI: features.supportsResponsesAPI,
      requestId: getCurrentRequest()?.id,
    })

    debugLogger.api('GPT5_PROVIDER_THIRD_PARTY_NOTICE', {
      model: opts.model,
      provider: modelProfile.provider,
      baseURL: modelProfile.baseURL,
    })

    if (modelProfile.provider === 'azure') {
      delete opts.reasoning_effort
    } else if (modelProfile.provider === 'custom-openai') {
      debugLogger.api('GPT5_CUSTOM_PROVIDER_OPTIMIZATIONS', {
        model: opts.model,
        provider: modelProfile.provider,
      })
    }
  } else if (opts.stream) {
    debugLogger.api('GPT5_STREAMING_MODE', {
      model: opts.model,
      baseURL: modelProfile.baseURL || 'official',
      reason: 'responses_api_no_streaming',
      requestId: getCurrentRequest()?.id,
    })

    debugLogger.api('GPT5_STREAMING_FALLBACK_TO_CHAT_COMPLETIONS', {
      model: opts.model,
      reason: 'responses_api_no_streaming',
    })
  }

  debugLogger.api('USING_CHAT_COMPLETIONS_FOR_GPT5', {
    model: opts.model,
    baseURL: modelProfile.baseURL || 'official',
    provider: modelProfile.provider,
    reason: isOfficialOpenAI ? 'streaming_or_fallback' : 'third_party_provider',
    requestId: getCurrentRequest()?.id,
  })

  return await getCompletionWithProfile(
    modelProfile,
    opts,
    attempt,
    maxAttempts,
    signal,
  )
}
