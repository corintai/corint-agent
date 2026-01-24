import models, { providers } from '@constants/models'
import { getProviderLabel } from './modelSelectorUtils'

const RANKED_PROVIDERS = [
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

export function buildProviderOptions() {
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

  const partnerProviders = RANKED_PROVIDERS.filter(
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

  return {
    mainMenuOptions,
    partnerProviderOptions,
    codingPlanOptions,
  }
}
