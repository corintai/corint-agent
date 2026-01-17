import type { Dispatch, SetStateAction } from 'react'
import { useInput } from 'ink'

import type { ProviderType } from '@utils/config'

import { CONTEXT_LENGTH_OPTIONS, DEFAULT_CONTEXT_LENGTH } from '../options'
import type { ConnectionTestResult, ModelSelectorScreen } from '../types'

type ModelSelectorOption = { value: string; label: string }

type ModelSelectorInputConfig = {
  activeFieldIndex: number
  apiKey: string
  codingPlanFocusIndex: number
  codingPlanOptions: ModelSelectorOption[]
  connectionTestResult: ConnectionTestResult | null
  contextLength: number
  currentScreen: ModelSelectorScreen
  customBaseUrl: string
  customModelName: string
  getFormFieldsForModelParams: () => Array<{ name: string; component: string }>
  isTestingConnection: boolean
  mainMenuOptions: ModelSelectorOption[]
  onApiKeySubmit: (key: string) => void
  onConfirmationSubmit: () => void
  onConnectionTest: () => void
  onContextLengthSubmit: () => void
  onCustomBaseUrlSubmit: (url: string) => void
  onCustomModelSubmit: (model: string) => void
  onFetchModelsWithRetry: () => void
  onModelParamsSubmit: () => void
  onNavigateTo: (screen: ModelSelectorScreen) => void
  onProviderBaseUrlSubmit: (url: string) => void
  onProviderSelection: (provider: string) => void
  onResourceNameSubmit: (name: string) => void
  partnerProviderFocusIndex: number
  partnerProviderOptions: ModelSelectorOption[]
  providerBaseUrl: string
  providerFocusIndex: number
  resourceName: string
  selectedProvider: ProviderType
  setActiveFieldIndex: Dispatch<SetStateAction<number>>
  setCodingPlanFocusIndex: Dispatch<SetStateAction<number>>
  setContextLength: Dispatch<SetStateAction<number>>
  setModelLoadError: (message: string) => void
  setPartnerProviderFocusIndex: Dispatch<SetStateAction<number>>
  setProviderFocusIndex: Dispatch<SetStateAction<number>>
}

export function useModelSelectorInput({
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
  onApiKeySubmit,
  onConfirmationSubmit,
  onConnectionTest,
  onContextLengthSubmit,
  onCustomBaseUrlSubmit,
  onCustomModelSubmit,
  onFetchModelsWithRetry,
  onModelParamsSubmit,
  onNavigateTo,
  onProviderBaseUrlSubmit,
  onProviderSelection,
  onResourceNameSubmit,
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
}: ModelSelectorInputConfig): void {
  useInput((input, key) => {
    if (currentScreen === 'provider') {
      if (key.upArrow) {
        setProviderFocusIndex(prev =>
          mainMenuOptions.length === 0
            ? 0
            : (prev - 1 + mainMenuOptions.length) % mainMenuOptions.length,
        )
        return
      }
      if (key.downArrow) {
        setProviderFocusIndex(prev =>
          mainMenuOptions.length === 0
            ? 0
            : (prev + 1) % mainMenuOptions.length,
        )
        return
      }
      if (key.return) {
        const opt = mainMenuOptions[providerFocusIndex]
        if (opt) {
          onProviderSelection(opt.value)
        }
        return
      }
    }

    if (currentScreen === 'partnerProviders') {
      if (key.upArrow) {
        setPartnerProviderFocusIndex(prev =>
          partnerProviderOptions.length === 0
            ? 0
            : (prev - 1 + partnerProviderOptions.length) %
              partnerProviderOptions.length,
        )
        return
      }
      if (key.downArrow) {
        setPartnerProviderFocusIndex(prev =>
          partnerProviderOptions.length === 0
            ? 0
            : (prev + 1) % partnerProviderOptions.length,
        )
        return
      }
      if (key.return) {
        const opt = partnerProviderOptions[partnerProviderFocusIndex]
        if (opt) {
          onProviderSelection(opt.value)
        }
        return
      }
    }

    if (currentScreen === 'partnerCodingPlans') {
      if (key.upArrow) {
        setCodingPlanFocusIndex(prev =>
          codingPlanOptions.length === 0
            ? 0
            : (prev - 1 + codingPlanOptions.length) % codingPlanOptions.length,
        )
        return
      }
      if (key.downArrow) {
        setCodingPlanFocusIndex(prev =>
          codingPlanOptions.length === 0
            ? 0
            : (prev + 1) % codingPlanOptions.length,
        )
        return
      }
      if (key.return) {
        const opt = codingPlanOptions[codingPlanFocusIndex]
        if (opt) {
          onProviderSelection(opt.value)
        }
        return
      }
    }

    if (currentScreen === 'apiKey' && key.return) {
      if (apiKey) {
        onApiKeySubmit(apiKey)
      }
      return
    }

    if (currentScreen === 'apiKey' && key.tab) {
      if (
        selectedProvider === 'anthropic' ||
        selectedProvider === 'kimi' ||
        selectedProvider === 'deepseek' ||
        selectedProvider === 'qwen' ||
        selectedProvider === 'glm' ||
        selectedProvider === 'glm-coding' ||
        selectedProvider === 'minimax' ||
        selectedProvider === 'minimax-coding' ||
        selectedProvider === 'baidu-qianfan' ||
        selectedProvider === 'siliconflow' ||
        selectedProvider === 'custom-openai'
      ) {
        onNavigateTo('modelInput')
        return
      }

      onFetchModelsWithRetry()
      return
    }

    if (currentScreen === 'resourceName' && key.return) {
      if (resourceName) {
        onResourceNameSubmit(resourceName)
      }
      return
    }

    if (currentScreen === 'baseUrl' && key.return) {
      if (selectedProvider === 'custom-openai') {
        onCustomBaseUrlSubmit(customBaseUrl)
      } else {
        onProviderBaseUrlSubmit(providerBaseUrl)
      }
      return
    }

    if (currentScreen === 'modelInput' && key.return) {
      if (customModelName) {
        onCustomModelSubmit(customModelName)
      }
      return
    }

    if (currentScreen === 'confirmation' && key.return) {
      onConfirmationSubmit()
      return
    }

    if (currentScreen === 'connectionTest') {
      if (key.return) {
        if (!isTestingConnection && !connectionTestResult) {
          onConnectionTest()
        } else if (connectionTestResult && connectionTestResult.success) {
          onNavigateTo('confirmation')
        } else if (connectionTestResult && !connectionTestResult.success) {
          onConnectionTest()
        }
        return
      }
    }

    if (currentScreen === 'contextLength') {
      if (key.return) {
        onContextLengthSubmit()
        return
      }

      if (key.upArrow) {
        const currentIndex = CONTEXT_LENGTH_OPTIONS.findIndex(
          opt => opt.value === contextLength,
        )
        const newIndex =
          currentIndex > 0
            ? currentIndex - 1
            : currentIndex === -1
              ? CONTEXT_LENGTH_OPTIONS.findIndex(
                  opt => opt.value === DEFAULT_CONTEXT_LENGTH,
                ) || 0
              : CONTEXT_LENGTH_OPTIONS.length - 1
        setContextLength(CONTEXT_LENGTH_OPTIONS[newIndex].value)
        return
      }

      if (key.downArrow) {
        const currentIndex = CONTEXT_LENGTH_OPTIONS.findIndex(
          opt => opt.value === contextLength,
        )
        const newIndex =
          currentIndex === -1
            ? CONTEXT_LENGTH_OPTIONS.findIndex(
                opt => opt.value === DEFAULT_CONTEXT_LENGTH,
              ) || 0
            : (currentIndex + 1) % CONTEXT_LENGTH_OPTIONS.length
        setContextLength(CONTEXT_LENGTH_OPTIONS[newIndex].value)
        return
      }
    }

    if (
      currentScreen === 'apiKey' &&
      ((key.ctrl && input === 'v') || (key.meta && input === 'v'))
    ) {
      setModelLoadError(
        "Please use your terminal's paste functionality or type the API key manually",
      )
      return
    }

    if (currentScreen === 'modelParams' && key.tab) {
      const formFields = getFormFieldsForModelParams()
      setActiveFieldIndex(current => (current + 1) % formFields.length)
      return
    }

    if (currentScreen === 'modelParams' && key.return) {
      const formFields = getFormFieldsForModelParams()
      const currentField = formFields[activeFieldIndex]

      if (
        currentField.name === 'submit' ||
        activeFieldIndex === formFields.length - 1
      ) {
        onModelParamsSubmit()
      } else if (currentField.component === 'select') {
        setActiveFieldIndex(current =>
          Math.min(current + 1, formFields.length - 1),
        )
      }
      return
    }
  })
}
