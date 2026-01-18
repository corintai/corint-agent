import React, { useEffect, useState } from 'react'
import { useStdout } from 'ink'

import models, { providers } from '@constants/models'
import { useExitOnCtrlCD } from '@hooks/useExitOnCtrlCD'
import {
  getGlobalConfig,
  ModelPointerType,
  ProviderType,
  setAllPointersToModel,
  setModelPointer,
} from '@utils/config'
import { getModelManager } from '@utils/model'
import { getTheme } from '@utils/theme'
import { debug as debugLogger } from '@utils/log/debugLogger'

import {
  CONTEXT_LENGTH_OPTIONS,
  DEFAULT_CONTEXT_LENGTH,
  DEFAULT_MAX_TOKENS,
  MAX_TOKENS_OPTIONS,
  ReasoningEffortOption,
} from './options'
import { printModelConfig } from './printModelConfig'
import type {
  ConnectionTestResult,
  ModelInfo,
  ModelSelectorScreen,
} from './types'
import { useEscapeNavigation } from './useEscapeNavigation'
import { ModelSelectionScreen } from './ModelSelectionScreen'
import { fetchModelsWithRetry, fetchOllamaModels } from './handlers/modelFetch'
import { runConnectionTest } from './handlers/connectionTest'
import { ApiKeyScreen } from './screens/ApiKeyScreen'
import { BaseUrlScreen } from './screens/BaseUrlScreen'
import { ConfirmationScreen } from './screens/ConfirmationScreen'
import { ConnectionTestScreen } from './screens/ConnectionTestScreen'
import { ContextLengthScreen } from './screens/ContextLengthScreen'
import { ModelInputScreen } from './screens/ModelInputScreen'
import { ModelParamsScreen } from './screens/ModelParamsScreen'
import { PartnerCodingPlansScreen } from './screens/PartnerCodingPlansScreen'
import { PartnerProvidersScreen } from './screens/PartnerProvidersScreen'
import { ProviderSelectionScreen } from './screens/ProviderSelectionScreen'
import { ResourceNameScreen } from './screens/ResourceNameScreen'
import { useModelSelectorInput } from './hooks/useModelSelectorInput'

type Props = {
  onDone: () => void
  abortController?: AbortController
  targetPointer?: ModelPointerType
  isOnboarding?: boolean
  onCancel?: () => void
  skipModelType?: boolean
}

export function ModelSelector({
  onDone: onDoneProp,
  abortController,
  targetPointer,
  isOnboarding = false,
  onCancel,
  skipModelType = false,
}: Props): React.ReactNode {
  const config = getGlobalConfig()
  const theme = getTheme()
  const { stdout } = useStdout()
  const terminalRows = stdout?.rows ?? 24
  const compactLayout = terminalRows <= 22
  const tightLayout = terminalRows <= 18
  const containerPaddingY = tightLayout ? 0 : compactLayout ? 0 : 1
  const containerGap = tightLayout ? 0 : 1
  const onDone = () => {
    printModelConfig()
    onDoneProp()
  }
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

  const goBack = () => {
    if (screenStack.length > 1) {
      setScreenStack(prev => prev.slice(0, -1))
    } else {
      onDone()
    }
  }

  const [selectedProvider, setSelectedProvider] = useState<ProviderType>(
    config.primaryProvider ?? 'anthropic',
  )

  const [selectedModel, setSelectedModel] = useState<string>('')
  const [apiKey, setApiKey] = useState<string>('')

  const [maxTokens, setMaxTokens] = useState<string>(
    config.maxTokens?.toString() || DEFAULT_MAX_TOKENS.toString(),
  )
  const [maxTokensMode, setMaxTokensMode] = useState<'preset' | 'custom'>(
    'preset',
  )
  const [selectedMaxTokensPreset, setSelectedMaxTokensPreset] =
    useState<number>(config.maxTokens || DEFAULT_MAX_TOKENS)
  const [reasoningEffort, setReasoningEffort] =
    useState<ReasoningEffortOption>('medium')
  const [supportsReasoningEffort, setSupportsReasoningEffort] =
    useState<boolean>(false)

  const [contextLength, setContextLength] = useState<number>(
    DEFAULT_CONTEXT_LENGTH,
  )

  const [activeFieldIndex, setActiveFieldIndex] = useState(0)
  const [maxTokensCursorOffset, setMaxTokensCursorOffset] = useState<number>(0)

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

  const [fetchRetryCount, setFetchRetryCount] = useState<number>(0)
  const [isRetrying, setIsRetrying] = useState<boolean>(false)

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
  const [ollamaBaseUrlCursorOffset, setOllamaBaseUrlCursorOffset] =
    useState<number>(0)

  const [customBaseUrl, setCustomBaseUrl] = useState<string>('')
  const [customBaseUrlCursorOffset, setCustomBaseUrlCursorOffset] =
    useState<number>(0)

  const [providerBaseUrl, setProviderBaseUrl] = useState<string>('')
  const [providerBaseUrlCursorOffset, setProviderBaseUrlCursorOffset] =
    useState<number>(0)

  const mainMenuOptions = [
    { value: 'custom-openai', label: 'Custom OpenAI-Compatible API' },
    { value: 'custom-anthropic', label: 'Custom Messages API (v1/messages)' },
    { value: 'partnerProviders', label: 'Partner Providers →' },
    { value: 'partnerCodingPlans', label: 'Partner Coding Plans →' },
    {
      value: 'ollama',
      label: getProviderLabel('ollama', models.ollama?.length || 0),
    },
  ]

  const rankedProviders = [
    'openai',
    'anthropic',
    'gemini',
    'glm',
    'kimi',
    'minimax',
    'qwen',
    'deepseek',
    'openrouter',
    'burncloud',
    'siliconflow',
    'baidu-qianfan',
    'mistral',
    'xai',
    'groq',
    'azure',
  ]

  const partnerProviders = rankedProviders.filter(
    provider =>
      providers[provider] &&
      !provider.includes('coding') &&
      provider !== 'custom-openai' &&
      provider !== 'ollama',
  )

  const codingPlanProviders = Object.keys(providers).filter(provider =>
    provider.includes('coding'),
  )

  const partnerProviderOptions = partnerProviders.map(provider => {
    const modelCount = models[provider]?.length || 0
    const label = getProviderLabel(provider, modelCount)
    return {
      label,
      value: provider,
    }
  })

  const codingPlanOptions = codingPlanProviders.map(provider => {
    const modelCount = models[provider]?.length || 0
    const label = getProviderLabel(provider, modelCount)
    return {
      label,
      value: provider,
    }
  })

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
  const clampIndex = (index: number, length: number) =>
    length === 0 ? 0 : Math.max(0, Math.min(index, length - 1))

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

  function getProviderLabel(provider: string, modelCount: number): string {
    if (providers[provider]) {
      return `${providers[provider].name} ${providers[provider].status === 'wip' ? '(WIP)' : ''}`
    }
    return `${provider}`
  }

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
      saveConfiguration(providerType, selectedModel || '')
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

  function getSafeVisibleOptionCount(
    requestedCount: number,
    optionLength: number,
    reservedLines: number = 10,
  ): number {
    const rows = terminalRows
    const available = Math.max(1, rows - reservedLines)
    return Math.max(1, Math.min(requestedCount, optionLength, available))
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

  function handleModelSelection(model: string) {
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

  async function saveConfiguration(
    provider: ProviderType,
    model: string,
  ): Promise<string | null> {
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

  async function handleConfirmation() {
    setValidationError(null)

    const modelId = await saveConfiguration(selectedProvider, selectedModel)

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

  function formatApiKeyDisplay(key: string): string {
    if (!key) return ''
    if (key.length <= 10) return '*'.repeat(key.length)

    const prefix = key.slice(0, 4)
    const suffix = key.slice(-4)
    const middleLength = Math.max(0, key.length - 8)
    const middle = '*'.repeat(Math.min(middleLength, 30))

    return `${prefix}${middle}${suffix}`
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
    6,
    partnerProviderOptions.length,
    partnerReservedLines,
  )
  const codingPlansMaxVisible = getSafeVisibleOptionCount(
    5,
    codingPlanOptions.length,
    codingReservedLines,
  )
  const providerMaxVisible = getSafeVisibleOptionCount(
    5,
    mainMenuOptions.length,
    providerReservedLines,
  )

  const formFields = getFormFieldsForModelParams()

  switch (currentScreen) {
    case 'apiKey':
      return (
        <ApiKeyScreen
          apiKey={apiKey}
          apiKeyCleanedNotification={apiKeyCleanedNotification}
          cursorOffset={cursorOffset}
          exitState={exitState}
          formatApiKeyDisplay={formatApiKeyDisplay}
          isLoadingModels={isLoadingModels}
          modelLoadError={modelLoadError}
          onApiKeyChange={handleApiKeyChange}
          onApiKeySubmit={handleApiKeySubmit}
          onCursorOffsetChange={handleCursorOffsetChange}
          providerBaseUrl={providerBaseUrl}
          providerLabel={providerDisplayName}
          selectedProvider={selectedProvider}
          theme={theme}
        />
      )
    case 'model':
      return (
        <ModelSelectionScreen
          theme={theme}
          exitState={exitState}
          providerLabel={
            getProviderLabel(selectedProvider, availableModels.length).split(
              ' (',
            )[0]!
          }
          modelTypeText="this model profile"
          availableModels={availableModels}
          modelSearchQuery={modelSearchQuery}
          onModelSearchChange={handleModelSearchChange}
          modelSearchCursorOffset={modelSearchCursorOffset}
          onModelSearchCursorOffsetChange={handleModelSearchCursorOffsetChange}
          onModelSelect={handleModelSelection}
        />
      )
    case 'modelParams':
      return (
        <ModelParamsScreen
          activeFieldIndex={activeFieldIndex}
          exitState={exitState}
          formFields={formFields}
          maxTokens={maxTokens}
          reasoningEffort={reasoningEffort}
          selectedModel={selectedModel}
          setActiveFieldIndex={setActiveFieldIndex}
          setMaxTokens={setMaxTokens}
          setMaxTokensCursorOffset={setMaxTokensCursorOffset}
          setSelectedMaxTokensPreset={setSelectedMaxTokensPreset}
          setReasoningEffort={setReasoningEffort}
          theme={theme}
        />
      )
    case 'resourceName':
      return (
        <ResourceNameScreen
          exitState={exitState}
          onSubmit={handleResourceNameSubmit}
          resourceName={resourceName}
          resourceNameCursorOffset={resourceNameCursorOffset}
          setResourceName={setResourceName}
          setResourceNameCursorOffset={setResourceNameCursorOffset}
          theme={theme}
        />
      )
    case 'baseUrl':
      return (
        <BaseUrlScreen
          customBaseUrl={customBaseUrl}
          customBaseUrlCursorOffset={customBaseUrlCursorOffset}
          exitState={exitState}
          isLoadingModels={isLoadingModels}
          modelLoadError={modelLoadError}
          onCustomBaseUrlSubmit={handleCustomBaseUrlSubmit}
          onProviderBaseUrlSubmit={handleProviderBaseUrlSubmit}
          providerBaseUrl={providerBaseUrl}
          providerBaseUrlCursorOffset={providerBaseUrlCursorOffset}
          selectedProvider={selectedProvider}
          setCustomBaseUrl={setCustomBaseUrl}
          setCustomBaseUrlCursorOffset={setCustomBaseUrlCursorOffset}
          setProviderBaseUrl={setProviderBaseUrl}
          setProviderBaseUrlCursorOffset={setProviderBaseUrlCursorOffset}
          theme={theme}
        />
      )
    case 'modelInput':
      return (
        <ModelInputScreen
          customModelName={customModelName}
          customModelNameCursorOffset={customModelNameCursorOffset}
          exitState={exitState}
          onSubmit={handleCustomModelSubmit}
          selectedProvider={selectedProvider}
          setCustomModelName={setCustomModelName}
          setCustomModelNameCursorOffset={setCustomModelNameCursorOffset}
          theme={theme}
        />
      )
    case 'contextLength':
      return (
        <ContextLengthScreen
          contextLength={contextLength}
          exitState={exitState}
          theme={theme}
        />
      )
    case 'connectionTest':
      return (
        <ConnectionTestScreen
          connectionTestResult={connectionTestResult}
          exitState={exitState}
          isTestingConnection={isTestingConnection}
          providerDisplayName={providerDisplayName}
          selectedProvider={selectedProvider}
          theme={theme}
        />
      )
    case 'confirmation':
      return (
        <ConfirmationScreen
          apiKey={apiKey}
          contextLength={contextLength}
          customBaseUrl={customBaseUrl}
          exitState={exitState}
          formatApiKeyDisplay={formatApiKeyDisplay}
          maxTokens={maxTokens}
          ollamaBaseUrl={ollamaBaseUrl}
          providerDisplayName={providerDisplayName}
          reasoningEffort={reasoningEffort}
          resourceName={resourceName}
          selectedModel={selectedModel}
          selectedProvider={selectedProvider}
          supportsReasoningEffort={supportsReasoningEffort}
          theme={theme}
          validationError={validationError}
        />
      )
    case 'partnerProviders':
      return (
        <PartnerProvidersScreen
          containerGap={containerGap}
          containerPaddingY={containerPaddingY}
          exitState={exitState}
          focusedIndex={partnerProviderFocusIndex}
          maxVisible={partnerProvidersMaxVisible}
          options={partnerProviderOptions}
          theme={theme}
          tightLayout={tightLayout}
        />
      )
    case 'partnerCodingPlans':
      return (
        <PartnerCodingPlansScreen
          compactLayout={compactLayout}
          containerGap={containerGap}
          containerPaddingY={containerPaddingY}
          exitState={exitState}
          focusedIndex={codingPlanFocusIndex}
          maxVisible={codingPlansMaxVisible}
          options={codingPlanOptions}
          theme={theme}
          tightLayout={tightLayout}
        />
      )
    default:
      return (
        <ProviderSelectionScreen
          compactLayout={compactLayout}
          containerGap={containerGap}
          containerPaddingY={containerPaddingY}
          exitState={exitState}
          focusedIndex={providerFocusIndex}
          maxVisible={providerMaxVisible}
          options={mainMenuOptions}
          theme={theme}
          tightLayout={tightLayout}
        />
      )
  }
}
