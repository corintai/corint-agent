import OpenAI from 'openai'

import models, { providers } from '@constants/models'
import { debug as debugLogger } from '@utils/log/debugLogger'
import type { ProviderType } from '@utils/config'

import * as modelFetchers from '../modelFetchers'
import { DEFAULT_MAX_TOKENS } from '../options'
import type { ModelInfo, ModelSelectorScreen } from '../types'

type ModelFetchContext = {
  apiKey: string
  customBaseUrl: string
  ollamaBaseUrl: string
  providerBaseUrl: string
  selectedProvider: ProviderType
  navigateTo: (screen: ModelSelectorScreen) => void
  setAvailableModels: (models: ModelInfo[]) => void
  setFetchRetryCount: (value: number) => void
  setIsLoadingModels: (value: boolean) => void
  setIsRetrying: (value: boolean) => void
  setModelLoadError: (value: string | null) => void
}

export async function fetchOllamaModels(
  ctx: ModelFetchContext,
): Promise<ModelInfo[]> {
  try {
    const response = await fetch(`${ctx.ollamaBaseUrl}/models`)

    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}: ${response.statusText}`)
    }

    const responseData = await response.json()

    let models = []

    if (responseData.data && Array.isArray(responseData.data)) {
      models = responseData.data
    } else if (Array.isArray(responseData.models)) {
      models = responseData.models
    } else if (Array.isArray(responseData)) {
      models = responseData
    } else {
      throw new Error(
        'Invalid response from Ollama API: missing models array',
      )
    }

    const ollamaModels = models.map((model: any) => ({
      model:
        model.id ??
        model.name ??
        model.modelName ??
        (typeof model === 'string' ? model : ''),
      provider: 'ollama',
      max_tokens: DEFAULT_MAX_TOKENS,
      supports_vision: false,
      supports_function_calling: true,
      supports_reasoning_effort: false,
    }))

    const validModels = ollamaModels.filter(model => model.model)

    const normalizeOllamaRoot = (url: string): string => {
      try {
        const u = new URL(url)
        let pathname = u.pathname.replace(/\/+$|^$/, '')
        if (pathname.endsWith('/v1')) {
          pathname = pathname.slice(0, -3)
        }
        u.pathname = pathname
        return u.toString().replace(/\/+$/, '')
      } catch {
        return url.replace(/\/v1\/?$/, '')
      }
    }

    const extractContextTokens = (data: any): number | null => {
      if (!data || typeof data !== 'object') return null

      if (data.model_info && typeof data.model_info === 'object') {
        const modelInfo = data.model_info
        for (const key of Object.keys(modelInfo)) {
          if (key.endsWith('.context_length') || key.endsWith('_context_length')) {
            const val = modelInfo[key]
            if (typeof val === 'number' && isFinite(val) && val > 0) {
              return val
            }
          }
        }
      }

      const candidates = [
        (data as any)?.parameters?.num_ctx,
        (data as any)?.model_info?.num_ctx,
        (data as any)?.config?.num_ctx,
        (data as any)?.details?.context_length,
        (data as any)?.context_length,
        (data as any)?.num_ctx,
        (data as any)?.max_tokens,
        (data as any)?.max_new_tokens,
      ].filter((v: any) => typeof v === 'number' && isFinite(v) && v > 0)
      if (candidates.length > 0) {
        return Math.max(...candidates)
      }

      if (typeof (data as any)?.parameters === 'string') {
        const m = (data as any).parameters.match(/num_ctx\s*[:=]\s*(\d+)/i)
        if (m) {
          const n = parseInt(m[1], 10)
          if (Number.isFinite(n) && n > 0) return n
        }
      }
      return null
    }

    const ollamaRoot = normalizeOllamaRoot(ctx.ollamaBaseUrl)
    const enrichedModels = await Promise.all(
      validModels.map(async (m: any) => {
        try {
          const showResp = await fetch(`${ollamaRoot}/api/show`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: m.model }),
          })
          if (showResp.ok) {
            const showData = await showResp.json()
            const ctxTokens = extractContextTokens(showData)
            if (typeof ctxTokens === 'number' && isFinite(ctxTokens) && ctxTokens > 0) {
              return { ...m, context_length: ctxTokens }
            }
          }
          return m
        } catch {
          return m
        }
      }),
    )

    ctx.setAvailableModels(enrichedModels)

    if (enrichedModels.length > 0) {
      ctx.navigateTo('model')
    } else {
      ctx.setModelLoadError('No models found in your Ollama installation')
    }

    return enrichedModels
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    if (errorMessage.includes('fetch')) {
      ctx.setModelLoadError(
        `Could not connect to Ollama server at ${ctx.ollamaBaseUrl}. Make sure Ollama is running and the URL is correct.`,
      )
    } else {
      ctx.setModelLoadError(`Error loading Ollama models: ${errorMessage}`)
    }

    debugLogger.warn('OLLAMA_FETCH_ERROR', {
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }
}

export async function fetchModelsWithRetry(
  ctx: ModelFetchContext,
): Promise<ModelInfo[]> {
  const MAX_RETRIES = 2
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    ctx.setFetchRetryCount(attempt)
    ctx.setIsRetrying(attempt > 1)

    if (attempt > 1) {
      ctx.setModelLoadError(
        `Attempt ${attempt}/${MAX_RETRIES}: Retrying model discovery...`,
      )
      await new Promise(resolve => setTimeout(resolve, 1000))
    }

    try {
      const models = await fetchModels(ctx)
      ctx.setFetchRetryCount(0)
      ctx.setIsRetrying(false)
      ctx.setModelLoadError(null)
      return models
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      debugLogger.warn('MODEL_FETCH_RETRY_FAILED', {
        attempt,
        maxRetries: MAX_RETRIES,
        error: lastError.message,
        provider: ctx.selectedProvider,
      })

      if (attempt === MAX_RETRIES) {
        break
      }
    }
  }

  ctx.setIsRetrying(false)
  const errorMessage = lastError?.message || 'Unknown error'

  const supportsManualInput = [
    'anthropic',
    'kimi',
    'deepseek',
    'siliconflow',
    'qwen',
    'glm',
    'minimax',
    'baidu-qianfan',
    'custom-openai',
  ].includes(ctx.selectedProvider)

  ctx.setModelLoadError(
    `Failed to validate API key after ${MAX_RETRIES} attempts: ${errorMessage}\n\nPlease check your API key and try again, or press Tab to manually enter model name.`,
  )

  throw new Error(`API key validation failed: ${errorMessage}`)
}

export async function fetchModels(
  ctx: ModelFetchContext,
): Promise<ModelInfo[]> {
  ctx.setIsLoadingModels(true)
  ctx.setModelLoadError(null)

  try {
    if (ctx.selectedProvider === 'anthropic') {
      const anthropicModels =
        await modelFetchers.fetchAnthropicCompatibleProviderModels({
          apiKey: ctx.apiKey,
          providerBaseUrl: ctx.providerBaseUrl,
          setModelLoadError: ctx.setModelLoadError,
        })
      ctx.setAvailableModels(anthropicModels)
      ctx.navigateTo('model')
      return anthropicModels
    }

    if (ctx.selectedProvider === 'custom-openai') {
      const customModels = await modelFetchers.fetchCustomOpenAIModels({
        apiKey: ctx.apiKey,
        customBaseUrl: ctx.customBaseUrl,
        setModelLoadError: ctx.setModelLoadError,
      })
      ctx.setAvailableModels(customModels)
      ctx.navigateTo('model')
      return customModels
    }

    if (ctx.selectedProvider === 'gemini') {
      const geminiModels = await modelFetchers.fetchGeminiModels({
        apiKey: ctx.apiKey,
        setModelLoadError: ctx.setModelLoadError,
      })
      ctx.setAvailableModels(geminiModels)
      ctx.navigateTo('model')
      return geminiModels
    }

    if (ctx.selectedProvider === 'kimi') {
      const kimiModels = await modelFetchers.fetchKimiModels({
        apiKey: ctx.apiKey,
        providerBaseUrl: ctx.providerBaseUrl,
        setModelLoadError: ctx.setModelLoadError,
      })
      ctx.setAvailableModels(kimiModels)
      ctx.navigateTo('model')
      return kimiModels
    }

    if (ctx.selectedProvider === 'deepseek') {
      const deepseekModels = await modelFetchers.fetchDeepSeekModels({
        apiKey: ctx.apiKey,
        providerBaseUrl: ctx.providerBaseUrl,
        setModelLoadError: ctx.setModelLoadError,
      })
      ctx.setAvailableModels(deepseekModels)
      ctx.navigateTo('model')
      return deepseekModels
    }

    if (ctx.selectedProvider === 'siliconflow') {
      const siliconflowModels = await modelFetchers.fetchSiliconFlowModels({
        apiKey: ctx.apiKey,
        providerBaseUrl: ctx.providerBaseUrl,
        setModelLoadError: ctx.setModelLoadError,
      })
      ctx.setAvailableModels(siliconflowModels)
      ctx.navigateTo('model')
      return siliconflowModels
    }

    if (ctx.selectedProvider === 'qwen') {
      const qwenModels = await modelFetchers.fetchQwenModels({
        apiKey: ctx.apiKey,
        providerBaseUrl: ctx.providerBaseUrl,
        setModelLoadError: ctx.setModelLoadError,
      })
      ctx.setAvailableModels(qwenModels)
      ctx.navigateTo('model')
      return qwenModels
    }

    if (ctx.selectedProvider === 'glm') {
      const glmModels = await modelFetchers.fetchGLMModels({
        apiKey: ctx.apiKey,
        providerBaseUrl: ctx.providerBaseUrl,
        setModelLoadError: ctx.setModelLoadError,
      })
      ctx.setAvailableModels(glmModels)
      ctx.navigateTo('model')
      return glmModels
    }

    if (ctx.selectedProvider === 'baidu-qianfan') {
      const baiduModels = await modelFetchers.fetchBaiduQianfanModels({
        apiKey: ctx.apiKey,
        providerBaseUrl: ctx.providerBaseUrl,
        setModelLoadError: ctx.setModelLoadError,
      })
      ctx.setAvailableModels(baiduModels)
      ctx.navigateTo('model')
      return baiduModels
    }

    if (ctx.selectedProvider === 'azure') {
      ctx.navigateTo('modelInput')
      return []
    }

    let baseURL = ctx.providerBaseUrl || providers[ctx.selectedProvider]?.baseURL

    if (ctx.selectedProvider === 'custom-openai') {
      baseURL = ctx.customBaseUrl
    }

    const openai = new OpenAI({
      apiKey: ctx.apiKey || 'dummy-key-for-ollama',
      baseURL: baseURL,
      dangerouslyAllowBrowser: true,
    })

    const response = await openai.models.list()

    const fetchedModels = []
    for (const model of response.data) {
      const modelName =
        (model as any).modelName ||
        (model as any).id ||
        (model as any).name ||
        (model as any).model ||
        'unknown'
      const modelInfo = models[ctx.selectedProvider as keyof typeof models]?.find(
        m => m.model === modelName,
      )
      fetchedModels.push({
        model: modelName,
        provider: ctx.selectedProvider,
        max_tokens: modelInfo?.max_output_tokens,
        supports_vision: modelInfo?.supports_vision || false,
        supports_function_calling:
          modelInfo?.supports_function_calling || false,
        supports_reasoning_effort:
          modelInfo?.supports_reasoning_effort || false,
      })
    }

    ctx.setAvailableModels(fetchedModels)

    ctx.navigateTo('model')

    return fetchedModels
  } catch (error) {
    debugLogger.warn('MODEL_FETCH_ERROR', {
      provider: ctx.selectedProvider,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  } finally {
    ctx.setIsLoadingModels(false)
  }
}
