import React from 'react'

import type { ModelPointerType } from '@utils/config'

import { printModelConfig } from './printModelConfig'
import { ModelSelectionScreen } from './ModelSelectionScreen'
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
import { useModelSelectorState } from './hooks/useModelSelectorState'

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
  skipModelType: _skipModelType = false,
}: Props): React.ReactNode {
  const onDone = () => {
    printModelConfig()
    onDoneProp()
  }

  const {
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
  } = useModelSelectorState({
    onDone,
    abortController,
    targetPointer,
    isOnboarding,
    onCancel,
  })

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
          providerLabel={providerDisplayName}
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
