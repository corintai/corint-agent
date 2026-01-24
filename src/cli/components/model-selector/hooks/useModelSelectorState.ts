import { useEffect, useState } from 'react'
import { useStdout } from 'ink'

import { providers } from '@constants/models'
import { useExitOnCtrlCD } from '@hooks/useExitOnCtrlCD'
import {
  getGlobalConfig,
  ModelPointerType,
  ProviderType,
  setAllPointersToModel,
  setModelPointer,
} from '@utils/config'
import { getTheme } from '@utils/theme'
import { debug as debugLogger } from '@utils/log/debugLogger'

import {
  CONTEXT_LENGTH_OPTIONS,
  DEFAULT_CONTEXT_LENGTH,
  DEFAULT_MAX_TOKENS,
  MAX_TOKENS_OPTIONS,
  ReasoningEffortOption,
} from '../options'
import type {
  ConnectionTestResult,
  ModelInfo,
  ModelSelectorScreen,
} from '../types'
import { useEscapeNavigation } from '../useEscapeNavigation'
import { fetchModelsWithRetry, fetchOllamaModels } from '../handlers/modelFetch'
import { runConnectionTest } from '../handlers/connectionTest'
import { useModelSelectorInput } from './useModelSelectorInput'
import {
  clampIndex,
  formatApiKeyDisplay,
  getProviderLabel,
  getSafeVisibleOptionCount,
} from '../modelSelectorUtils'
import {
  createHandleModelSelection,
  saveModelConfiguration,
} from '../modelSelectorActions'
import { buildProviderOptions } from '../modelSelectorOptions'

type ModelSelectorStateArgs = {
  onDone: () => void
  abortController?: AbortController
  targetPointer?: ModelPointerType
  isOnboarding?: boolean
  onCancel?: () => void
}

export function useModelSelectorState({
  onDone,
  abortController,
  targetPointer,
  isOnboarding = false,
  onCancel,
}: ModelSelectorStateArgs) {
  const config = getGlobalConfig()
  const theme = getTheme()
  const { stdout } = useStdout()
  const terminalRows = stdout?.rows ?? 24
  const compactLayout = terminalRows <= 22
  const tightLayout = terminalRows <= 18
  const containerPaddingY = tightLayout ? 0 : compactLayout ? 0 : 1
  const containerGap = tightLayout ? 0 : 1
  const exitState = useExitOnCtrlCD(() => process.exit(0))

  const getInitialScreen = (): ModelSelectorScreen => {
    return 'provider'
  }

  const [screenStack, setScreenStack] = useState<ModelSelectorScreen[]>([
    getInitialScreen(),
  ])

  const currentScreen = screenStack[screenStack.length - 1]

  const navigateTo = (screen: ModelSelectorScreen) => {
    setScreenStack(prev => [...prev, screen])
  }

  const [selectedProvider, setSelectedProvider] = useState<ProviderType>(
    config.primaryProvider ?? 'anthropic',
  )

  const [selectedModel, setSelectedModel] = useState<string>('')
  const [apiKey, setApiKey] = useState<string>('')

  const [maxTokens, setMaxTokens] = useState<string>(
    config.maxTokens?.toString() || DEFAULT_MAX_TOKENS.toString(),
  )
  const [_maxTokensMode, setMaxTokensMode] = useState<'preset' | 'custom'>(
    'preset',
  )
  const [_selectedMaxTokensPreset, setSelectedMaxTokensPreset] =
    useState<number>(config.maxTokens || DEFAULT_MAX_TOKENS)
  const [reasoningEffort, setReasoningEffort] =
    useState<ReasoningEffortOption>('medium')
  const [supportsReasoningEffort, setSupportsReasoningEffort] =
    useState<boolean>(false)

  const [contextLength, setContextLength] = useState<number>(
    DEFAULT_CONTEXT_LENGTH,
  )

  const [activeFieldIndex, setActiveFieldIndex] = useState(0)
  const [_maxTokensCursorOffset, setMaxTokensCursorOffset] =
    useState<number>(0)

  const [apiKeyCleanedNotification, setApiKeyCleanedNotification] =
    useState<boolean>(false)

  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([])
  const [isLoadingModels, setIsLoadingModels] = useState(false)
  const [modelLoadError, setModelLoadError] = useState<string | null>(null)
  const [modelSearchQuery, setModelSearchQuery] = useState<string>('')
  const [modelSearchCursorOffset, setModelSearchCursorOffset] =
    useState<number>(0)
  const [cursorOffset, setCursorOffset] = useState<number>(0)
  const [apiKeyEdited, setApiKeyEdited] = useState<boolean>(false)
  const [providerFocusIndex, setProviderFocusIndex] = useState(0)
  const [partnerProviderFocusIndex, setPartnerProviderFocusIndex] = useState(0)
  const [codingPlanFocusIndex, setCodingPlanFocusIndex] = useState(0)

  const [_fetchRetryCount, setFetchRetryCount] = useState<number>(0)
  const [_isRetrying, setIsRetrying] = useState<boolean>(false)

  const [isTestingConnection, setIsTestingConnection] = useState<boolean>(false)
  const [connectionTestResult, setConnectionTestResult] =
    useState<ConnectionTestResult | null>(null)

  const [validationError, setValidationError] = useState<string | null>(null)

  const [resourceName, setResourceName] = useState<string>('')
  const [resourceNameCursorOffset, setResourceNameCursorOffset] =
    useState<number>(0)
  const [customModelName, setCustomModelName] = useState<string>('')
  const [customModelNameCursorOffset, setCustomModelNameCursorOffset] =
    useState<number>(0)

  const [ollamaBaseUrl, setOllamaBaseUrl] = useState<string>(
    'http://localhost:11434/v1',
  )
  const [_ollamaBaseUrlCursorOffset, _setOllamaBaseUrlCursorOffset] =
    useState<number>(0)

  const [customBaseUrl, setCustomBaseUrl] = useState<string>('')
  const [customBaseUrlCursorOffset, setCustomBaseUrlCursorOffset] =
    useState<number>(0)

  const [providerBaseUrl, setProviderBaseUrl] = useState<string>('')
  const [providerBaseUrlCursorOffset, setProviderBaseUrlCursorOffset] =
    useState<number>(0)

  const { mainMenuOptions, partnerProviderOptions, codingPlanOptions } =
    buildProviderOptions()

  useEffect(() => {
    if (!apiKeyEdited && selectedProvider) {
      if (process.env[selectedProvider.toUpperCase() + '_API_KEY']) {
        setApiKey(
          process.env[selectedProvider.toUpperCase() + '_API_KEY'] as string,
        )
      } else {
        setApiKey('')
      }
    }
  }, [selectedProvider, apiKey, apiKeyEdited])

  useEffect(() => {
    if (
      currentScreen === 'contextLength' &&
      !CONTEXT_LENGTH_OPTIONS.find(opt => opt.value === contextLength)
    ) {
      setContextLength(DEFAULT_CONTEXT_LENGTH)
    }
  }, [currentScreen, contextLength])

  const providerReservedLines = 8 + containerPaddingY * 2 + containerGap * 2
  const partnerReservedLines = 10 + containerPaddingY * 2 + containerGap * 3
  const codingReservedLines = partnerReservedLines

  useEffect(() => {
    setProviderFocusIndex(prev => clampIndex(prev, mainMenuOptions.length))
  }, [mainMenuOptions.length])

  useEffect(() => {
    setPartnerProviderFocusIndex(prev =>
      clampIndex(prev, partnerProviderOptions.length),
    )
  }, [partnerProviderOptions.length])

  useEffect(() => {
    setCodingPlanFocusIndex(prev => clampIndex(prev, codingPlanOptions.length))
  }, [codingPlanOptions.length])

  function handleProviderSelection(provider: string) {
    if (provider === 'partnerProviders') {
      setPartnerProviderFocusIndex(0)
      navigateTo('partnerProviders')
      return
    } else if (provider === 'partnerCodingPlans') {
      setCodingPlanFocusIndex(0)
      navigateTo('partnerCodingPlans')
      return
    } else if (provider === 'custom-anthropic') {
      setSelectedProvider('anthropic' as ProviderType)
      setProviderBaseUrl('')
      navigateTo('baseUrl')
      return
    }

    const providerType = provider as ProviderType
    setSelectedProvider(providerType)

    if (provider === 'custom') {
      void saveModelConfiguration({
        provider: providerType,
        model: selectedModel || '',
        providerBaseUrl,
        resourceName,
        customBaseUrl,
        apiKey,
        maxTokens,
        contextLength,
        reasoningEffort,
        setValidationError,
      })
      onDone()
    } else if (provider === 'custom-openai' || provider === 'ollama') {
      const defaultBaseUrl = providers[providerType]?.baseURL || ''
      setProviderBaseUrl(defaultBaseUrl)
      navigateTo('baseUrl')
    } else {
      const defaultBaseUrl = providers[providerType]?.baseURL || ''
      setProviderBaseUrl(defaultBaseUrl)
      navigateTo('apiKey')
    }
  }

  const buildFetchContext = () => ({
    apiKey,
    customBaseUrl,
    ollamaBaseUrl,
    providerBaseUrl,
    selectedProvider,
    navigateTo,
    setAvailableModels,
    setFetchRetryCount,
    setIsLoadingModels,
    setIsRetrying,
    setModelLoadError,
  })

  async function handleApiKeySubmit(key: string) {
    const cleanedKey = key.replace(/[\r\n]/g, '').trim()
    setApiKey(cleanedKey)

    setModelLoadError(null)

    if (selectedProvider === 'azure') {
      navigateTo('resourceName')
      return
    }

    try {
      setIsLoadingModels(true)
      const models = await fetchModelsWithRetry(buildFetchContext())

      if (models && models.length > 0) {
      } else if (models && models.length === 0) {
        navigateTo('modelInput')
      }
    } catch (error) {
      debugLogger.warn('API_KEY_VALIDATION_FAILED', {
        provider: selectedProvider,
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setIsLoadingModels(false)
    }
  }

  function handleResourceNameSubmit(name: string) {
    setResourceName(name)
    navigateTo('modelInput')
  }

  function handleOllamaBaseUrlSubmit(url: string) {
    setOllamaBaseUrl(url)
    setIsLoadingModels(true)
    setModelLoadError(null)

    fetchOllamaModels(buildFetchContext()).finally(() => {
      setIsLoadingModels(false)
    })
  }

  function handleCustomBaseUrlSubmit(url: string) {
    const cleanUrl = url.replace(/\/+$/, '')
    setCustomBaseUrl(cleanUrl)
    navigateTo('apiKey')
  }

  function handleProviderBaseUrlSubmit(url: string) {
    const cleanUrl = url.replace(/\/+$/, '')
    setProviderBaseUrl(cleanUrl)

    if (selectedProvider === 'ollama') {
      setOllamaBaseUrl(cleanUrl)
      setIsLoadingModels(true)
      setModelLoadError(null)

      fetchOllamaModels(buildFetchContext()).finally(() => {
        setIsLoadingModels(false)
      })
    } else {
      navigateTo('apiKey')
    }
  }

  function handleCustomModelSubmit(model: string) {
    setCustomModelName(model)
    setSelectedModel(model)

    setSupportsReasoningEffort(false)
    setReasoningEffort(null)

    setMaxTokensMode('preset')
    setSelectedMaxTokensPreset(DEFAULT_MAX_TOKENS)
    setMaxTokens(DEFAULT_MAX_TOKENS.toString())
    setMaxTokensCursorOffset(DEFAULT_MAX_TOKENS.toString().length)

    navigateTo('modelParams')
    setActiveFieldIndex(0)
  }

  const handleModelSelection = createHandleModelSelection({
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
  })

  const handleModelParamsSubmit = () => {
    if (!CONTEXT_LENGTH_OPTIONS.find(opt => opt.value === contextLength)) {
      setContextLength(DEFAULT_CONTEXT_LENGTH)
    }
    navigateTo('contextLength')
  }

  async function handleConnectionTest() {
    const result = await runConnectionTest({
      apiKey,
      customBaseUrl,
      maxTokens,
      providerBaseUrl,
      resourceName,
      selectedModel,
      selectedProvider,
      setConnectionTestResult,
      setIsTestingConnection,
    })
    setConnectionTestResult(result)

    if (result.success) {
      setTimeout(() => {
        navigateTo('confirmation')
      }, 2000)
    }
  }

  const handleContextLengthSubmit = () => {
    navigateTo('connectionTest')
  }

  async function handleConfirmation() {
    setValidationError(null)

    const modelId = await saveModelConfiguration({
      provider: selectedProvider,
      model: selectedModel,
      providerBaseUrl,
      resourceName,
      customBaseUrl,
      apiKey,
      maxTokens,
      contextLength,
      reasoningEffort,
      setValidationError,
    })

    if (!modelId) {
      return
    }

    setModelPointer('main', modelId)

    if (isOnboarding) {
      setAllPointersToModel(modelId)
    } else if (targetPointer && targetPointer !== 'main') {
      setModelPointer(targetPointer, modelId)
    }

    onDone()
  }

  const handleBack = () => {
    if (
      currentScreen === 'partnerProviders' ||
      currentScreen === 'partnerCodingPlans'
    ) {
      setProviderFocusIndex(0)
      setScreenStack(['provider'])
      return
    }

    if (currentScreen === 'provider') {
      if (onCancel) {
        onCancel()
      } else {
        onDone()
      }
      return
    }

    if (currentScreen === 'apiKey' && screenStack.length >= 2) {
      const previousScreen = screenStack[screenStack.length - 2]
      if (
        previousScreen === 'partnerProviders' ||
        previousScreen === 'partnerCodingPlans'
      ) {
        setScreenStack(prev => prev.slice(0, -1))
        return
      }
    }

    if (screenStack.length > 1) {
      setScreenStack(prev => prev.slice(0, -1))
    } else {
      setProviderFocusIndex(0)
      setScreenStack(['provider'])
    }
  }

  useEscapeNavigation(handleBack, abortController)

  function handleCursorOffsetChange(offset: number) {
    setCursorOffset(offset)
  }

  function handleApiKeyChange(value: string) {
    setApiKeyEdited(true)
    const cleanedValue = value.replace(/[\r\n]/g, '').trim()

    if (value !== cleanedValue && value.length > 0) {
      setApiKeyCleanedNotification(true)
      setTimeout(() => setApiKeyCleanedNotification(false), 3000)
    }

    setApiKey(cleanedValue)
    setCursorOffset(cleanedValue.length)
  }

  function handleModelSearchChange(value: string) {
    setModelSearchQuery(value)
    setModelSearchCursorOffset(value.length)
  }

  function handleModelSearchCursorOffsetChange(offset: number) {
    setModelSearchCursorOffset(offset)
  }

  const handleFetchModelsWithRetry = () => {
    fetchModelsWithRetry(buildFetchContext()).catch(error => {
      debugLogger.warn('MODEL_FETCH_FINAL_ERROR', {
        provider: selectedProvider,
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }

  const handleConfirmationSubmit = () => {
    handleConfirmation().catch(error => {
      debugLogger.warn('CONFIRMATION_ERROR', {
        error: error instanceof Error ? error.message : String(error),
      })
      setValidationError(
        error instanceof Error ? error.message : 'Unexpected error occurred',
      )
    })
  }

  useModelSelectorInput({
    activeFieldIndex,
    apiKey,
    codingPlanFocusIndex,
    codingPlanOptions,
    connectionTestResult,
    contextLength,
    currentScreen,
    customBaseUrl,
    customModelName,
    getFormFieldsForModelParams,
    isTestingConnection,
    mainMenuOptions,
    onApiKeySubmit: handleApiKeySubmit,
    onConfirmationSubmit: handleConfirmationSubmit,
    onConnectionTest: handleConnectionTest,
    onContextLengthSubmit: handleContextLengthSubmit,
    onCustomBaseUrlSubmit: handleCustomBaseUrlSubmit,
    onCustomModelSubmit: handleCustomModelSubmit,
    onFetchModelsWithRetry: handleFetchModelsWithRetry,
    onModelParamsSubmit: handleModelParamsSubmit,
    onNavigateTo: navigateTo,
    onProviderBaseUrlSubmit: handleProviderBaseUrlSubmit,
    onProviderSelection: handleProviderSelection,
    onResourceNameSubmit: handleResourceNameSubmit,
    partnerProviderFocusIndex,
    partnerProviderOptions,
    providerBaseUrl,
    providerFocusIndex,
    resourceName,
    selectedProvider,
    setActiveFieldIndex,
    setCodingPlanFocusIndex,
    setContextLength,
    setModelLoadError,
    setPartnerProviderFocusIndex,
    setProviderFocusIndex,
  })

  type ModelParamField = {
    name: string
    label: string
    description?: string
    value?: any
    component: 'select' | 'button'
    options?: Array<{ label: string; value: string }>
    defaultValue?: string
  }

  function getFormFieldsForModelParams() {
    return [
      {
        name: 'maxTokens',
        label: 'Maximum Tokens',
        description: 'Select the maximum number of tokens to generate.',
        value: parseInt(maxTokens),
        component: 'select' as const,
        options: MAX_TOKENS_OPTIONS.map(option => ({
          label: option.label,
          value: option.value.toString(),
        })),
        defaultValue: maxTokens,
      },
      ...(supportsReasoningEffort
        ? [
            {
              name: 'reasoningEffort',
              label: 'Reasoning Effort',
              description: 'Controls reasoning depth for complex problems.',
              value: reasoningEffort,
              component: 'select' as const,
            },
          ]
        : []),
      {
        name: 'submit',
        label: 'Continue →',
        component: 'button' as const,
      },
    ] as ModelParamField[]
  }

  const providerDisplayName = getProviderLabel(selectedProvider, 0).split(
    ' (',
  )[0]

  const partnerProvidersMaxVisible = getSafeVisibleOptionCount(
    terminalRows,
    6,
    partnerProviderOptions.length,
    partnerReservedLines,
  )
  const codingPlansMaxVisible = getSafeVisibleOptionCount(
    terminalRows,
    5,
    codingPlanOptions.length,
    codingReservedLines,
  )
  const providerMaxVisible = getSafeVisibleOptionCount(
    terminalRows,
    5,
    mainMenuOptions.length,
    providerReservedLines,
  )

  const formFields = getFormFieldsForModelParams()

  return {
    theme,
    exitState,
    currentScreen,
    compactLayout,
    tightLayout,
    containerPaddingY,
    containerGap,
    mainMenuOptions,
    partnerProviderOptions,
    codingPlanOptions,
    providerDisplayName,
    partnerProvidersMaxVisible,
    codingPlansMaxVisible,
    providerMaxVisible,
    apiKey,
    apiKeyCleanedNotification,
    cursorOffset,
    isLoadingModels,
    modelLoadError,
    providerBaseUrl,
    selectedProvider,
    availableModels,
    modelSearchQuery,
    modelSearchCursorOffset,
    activeFieldIndex,
    formFields,
    maxTokens,
    reasoningEffort,
    selectedModel,
    resourceName,
    resourceNameCursorOffset,
    customModelName,
    customModelNameCursorOffset,
    customBaseUrl,
    customBaseUrlCursorOffset,
    providerBaseUrlCursorOffset,
    contextLength,
    connectionTestResult,
    isTestingConnection,
    validationError,
    ollamaBaseUrl,
    supportsReasoningEffort,
    providerFocusIndex,
    partnerProviderFocusIndex,
    codingPlanFocusIndex,
    formatApiKeyDisplay,
    handleApiKeyChange,
    handleApiKeySubmit,
    handleCursorOffsetChange,
    handleModelSearchChange,
    handleModelSearchCursorOffsetChange,
    handleModelSelection,
    handleResourceNameSubmit,
    handleCustomModelSubmit,
    handleCustomBaseUrlSubmit,
    handleProviderBaseUrlSubmit,
    handleContextLengthSubmit,
    handleConnectionTest,
    handleConfirmationSubmit,
    handleProviderSelection,
    setActiveFieldIndex,
    setMaxTokens,
    setMaxTokensCursorOffset,
    setSelectedMaxTokensPreset,
    setReasoningEffort,
    setResourceName,
    setResourceNameCursorOffset,
    setCustomModelName,
    setCustomModelNameCursorOffset,
    setCustomBaseUrl,
    setCustomBaseUrlCursorOffset,
    setProviderBaseUrl,
    setProviderBaseUrlCursorOffset,
    setContextLength,
  }
}
