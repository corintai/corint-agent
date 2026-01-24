import type { ProviderType } from '@utils/config'
import { getModelManager } from '@utils/model'
import { providers } from '@constants/models'

import type { ModelSelectorScreen } from './types'
import type { ModelInfo } from './types'
import {
  DEFAULT_CONTEXT_LENGTH,
  DEFAULT_MAX_TOKENS,
  MAX_TOKENS_OPTIONS,
  ReasoningEffortOption,
} from './options'

type HandleModelSelectionArgs = {
  availableModels: ModelInfo[]
  setSelectedModel: (value: string) => void
  setSupportsReasoningEffort: (value: boolean) => void
  setReasoningEffort: (value: ReasoningEffortOption | null) => void
  setContextLength: (value: number) => void
  setMaxTokensMode: (value: 'preset' | 'custom') => void
  setSelectedMaxTokensPreset: (value: number) => void
  setMaxTokens: (value: string) => void
  setMaxTokensCursorOffset: (value: number) => void
  navigateTo: (screen: ModelSelectorScreen) => void
  setActiveFieldIndex: (value: number) => void
}

export function createHandleModelSelection({
  availableModels,
  setSelectedModel,
  setSupportsReasoningEffort,
  setReasoningEffort,
  setContextLength,
  setMaxTokensMode,
  setSelectedMaxTokensPreset,
  setMaxTokens,
  setMaxTokensCursorOffset,
  navigateTo,
  setActiveFieldIndex,
}: HandleModelSelectionArgs) {
  return (model: string) => {
    setSelectedModel(model)

    const modelInfo = availableModels.find(m => m.model === model)
    setSupportsReasoningEffort(modelInfo?.supports_reasoning_effort || false)

    if (!modelInfo?.supports_reasoning_effort) {
      setReasoningEffort(null)
    }

    if (modelInfo?.context_length) {
      setContextLength(modelInfo.context_length)
    } else {
      setContextLength(DEFAULT_CONTEXT_LENGTH)
    }

    if (modelInfo?.max_tokens) {
      const modelMaxTokens = modelInfo.max_tokens
      const matchingPreset = MAX_TOKENS_OPTIONS.find(
        option => option.value === modelMaxTokens,
      )

      if (matchingPreset) {
        setMaxTokensMode('preset')
        setSelectedMaxTokensPreset(modelMaxTokens)
        setMaxTokens(modelMaxTokens.toString())
      } else {
        setMaxTokensMode('custom')
        setMaxTokens(modelMaxTokens.toString())
      }
      setMaxTokensCursorOffset(modelMaxTokens.toString().length)
    } else {
      setMaxTokensMode('preset')
      setSelectedMaxTokensPreset(DEFAULT_MAX_TOKENS)
      setMaxTokens(DEFAULT_MAX_TOKENS.toString())
      setMaxTokensCursorOffset(DEFAULT_MAX_TOKENS.toString().length)
    }

    navigateTo('modelParams')
    setActiveFieldIndex(0)
  }
}

type SaveModelConfigurationArgs = {
  provider: ProviderType
  model: string
  providerBaseUrl: string
  resourceName: string
  customBaseUrl: string
  apiKey: string
  maxTokens: string
  contextLength: number
  reasoningEffort: ReasoningEffortOption | null
  setValidationError: (message: string | null) => void
}

export async function saveModelConfiguration({
  provider,
  model,
  providerBaseUrl,
  resourceName,
  customBaseUrl,
  apiKey,
  maxTokens,
  contextLength,
  reasoningEffort,
  setValidationError,
}: SaveModelConfigurationArgs): Promise<string | null> {
  let baseURL = providerBaseUrl || providers[provider]?.baseURL || ''
  let actualProvider = provider

  if (provider === 'anthropic') {
    actualProvider = 'anthropic'
    baseURL = baseURL || 'https://api.anthropic.com'
  }

  if (provider === 'azure') {
    baseURL = `https://${resourceName}.openai.azure.com/openai/deployments/${model}`
  } else if (provider === 'custom-openai') {
    baseURL = customBaseUrl
  }

  try {
    const modelManager = getModelManager()

    const displayModel = model || 'default'
    const modelDisplayName =
      `${providers[actualProvider]?.name || actualProvider} ${displayModel}`.trim()

    const modelConfig = {
      name: modelDisplayName,
      provider: actualProvider,
      modelName: model || actualProvider,
      baseURL: baseURL,
      apiKey: apiKey || '',
      maxTokens: parseInt(maxTokens) || DEFAULT_MAX_TOKENS,
      contextLength: contextLength || DEFAULT_CONTEXT_LENGTH,
      reasoningEffort,
    }

    return await modelManager.addModel(modelConfig)
  } catch (error) {
    setValidationError(
      error instanceof Error ? error.message : 'Failed to add model',
    )
    return null
  }
}
