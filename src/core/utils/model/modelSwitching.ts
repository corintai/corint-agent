import type { ModelPointerType, ModelProfile } from '@utils/config'
import { GLOBAL_CONFIG_FILE } from '@utils/config/env'
import { debug as debugLogger } from '@utils/log/debugLogger'

export type ModelSwitchSkipped = {
  name: string
  provider: string
  contextLength: number
  budgetTokens: number | null
  usagePercentage: number
}

export type SwitchWithContextResult = {
  success: boolean
  modelName: string | null
  previousModelName: string | null
  contextOverflow: boolean
  usagePercentage: number
  currentContextTokens: number
  skippedModels?: ModelSwitchSkipped[]
}

export type SwitchResult = {
  success: boolean
  modelName: string | null
  blocked?: boolean
  message?: string
}

export type SwitchContext = {
  allProfiles: ModelProfile[]
  currentMainModelName?: string
  currentContextTokens: number
  setPointer: (pointer: ModelPointerType, modelName: string) => void
  updateLastUsed: (modelName: string) => void
  findModelProfile: (modelName?: string) => ModelProfile | null
}

export function switchToNextModelWithContextCheck(
  context: SwitchContext,
): SwitchWithContextResult {
  const allProfiles = context.allProfiles
  if (allProfiles.length === 0) {
    return {
      success: false,
      modelName: null,
      previousModelName: null,
      contextOverflow: false,
      usagePercentage: 0,
      currentContextTokens: context.currentContextTokens,
    }
  }

  allProfiles.sort((a, b) => a.createdAt - b.createdAt)

  const currentMainModelName = context.currentMainModelName
  const currentModel = currentMainModelName
    ? context.findModelProfile(currentMainModelName)
    : null
  const previousModelName = currentModel?.name || null

  const budgetForModel = (
    model: ModelProfile,
  ): {
    budgetTokens: number | null
    usagePercentage: number
    compatible: boolean
  } => {
    const contextLength = Number(model.contextLength)
    if (!Number.isFinite(contextLength) || contextLength <= 0) {
      debugLogger.warn('MODEL_INVALID_CONTEXT_LENGTH', {
        modelName: model.name,
        contextLength: model.contextLength,
      })
      return { budgetTokens: null, usagePercentage: 0, compatible: true }
    }
    const budgetTokens = Math.floor(contextLength * 0.9)
    const usagePercentage =
      budgetTokens > 0
        ? (context.currentContextTokens / budgetTokens) * 100
        : 0
    const compatible =
      budgetTokens > 0
        ? context.currentContextTokens <= budgetTokens
        : true

    debugLogger.info('MODEL_CONTEXT_BUDGET_CHECK', {
      modelName: model.name,
      contextLength,
      budgetTokens,
      currentContextTokens: context.currentContextTokens,
      usagePercentage: usagePercentage.toFixed(1),
      compatible,
    })

    return {
      budgetTokens,
      usagePercentage,
      compatible,
    }
  }

  const currentIndex = currentMainModelName
    ? allProfiles.findIndex(p => p.modelName === currentMainModelName)
    : -1
  const startIndex = currentIndex >= 0 ? currentIndex : -1

  if (allProfiles.length === 1) {
    return {
      success: false,
      modelName: null,
      previousModelName,
      contextOverflow: false,
      usagePercentage: 0,
      currentContextTokens: context.currentContextTokens,
    }
  }

  const maxOffsets =
    startIndex === -1 ? allProfiles.length : allProfiles.length - 1
  const skippedModels: ModelSwitchSkipped[] = []

  let selected: ModelProfile | null = null
  let selectedUsagePercentage = 0

  for (let offset = 1; offset <= maxOffsets; offset++) {
    const candidateIndex =
      (startIndex + offset + allProfiles.length) % allProfiles.length
    const candidate = allProfiles[candidateIndex]
    if (!candidate) continue

    const { budgetTokens, usagePercentage, compatible } =
      budgetForModel(candidate)
    if (compatible) {
      selected = candidate
      selectedUsagePercentage = usagePercentage
      break
    }
    skippedModels.push({
      name: candidate.name,
      provider: candidate.provider,
      contextLength: candidate.contextLength,
      budgetTokens,
      usagePercentage,
    })
  }

  if (!selected) {
    const firstSkipped = skippedModels[0]
    return {
      success: false,
      modelName: null,
      previousModelName,
      contextOverflow: true,
      usagePercentage: firstSkipped?.usagePercentage ?? 0,
      currentContextTokens: context.currentContextTokens,
      skippedModels,
    }
  }

  if (!selected.isActive) {
    selected.isActive = true
  }

  context.setPointer('main', selected.modelName)
  context.updateLastUsed(selected.modelName)

  return {
    success: true,
    modelName: selected.name,
    previousModelName,
    contextOverflow: false,
    usagePercentage: selectedUsagePercentage,
    currentContextTokens: context.currentContextTokens,
    skippedModels,
  }
}

export function switchToNextModel(context: SwitchContext): SwitchResult {
  const result = switchToNextModelWithContextCheck(context)

  const formatTokens = (tokens: number): string => {
    if (!Number.isFinite(tokens)) return 'unknown'
    if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`
    return String(Math.round(tokens))
  }

  const allModels = context.allProfiles
  if (allModels.length === 0) {
    return {
      success: false,
      modelName: null,
      blocked: false,
      message: `❌ No models configured. Edit ${GLOBAL_CONFIG_FILE} to add model profiles.`,
    }
  }
  if (allModels.length === 1) {
    return {
      success: false,
      modelName: null,
      blocked: false,
      message: `⚠️ Only one model configured (${allModels[0].modelName}). Add more profiles in ${GLOBAL_CONFIG_FILE} to enable switching.`,
    }
  }

  const currentModel = context.findModelProfile(context.currentMainModelName)
  const modelsSorted = [...allModels].sort((a, b) => a.createdAt - b.createdAt)
  const currentIndex = modelsSorted.findIndex(
    m => m.modelName === currentModel?.modelName,
  )
  const totalModels = modelsSorted.length

  if (result.success && result.modelName) {
    const skippedCount = result.skippedModels?.length ?? 0
    const skippedSuffix =
      skippedCount > 0 ? ` · skipped ${skippedCount} incompatible` : ''
    const contextSuffix =
      currentModel?.contextLength && result.currentContextTokens
        ? ` · context ~${formatTokens(result.currentContextTokens)}/${formatTokens(currentModel.contextLength)}`
        : ''

    return {
      success: true,
      modelName: result.modelName,
      blocked: false,
      message: `✅ Switched to ${result.modelName} (${currentIndex + 1}/${totalModels})${currentModel?.provider ? ` [${currentModel.provider}]` : ''}${skippedSuffix}${contextSuffix}`,
    }
  }

  if (result.contextOverflow) {
    const attempted = result.skippedModels?.[0]
    const attemptedContext = attempted?.contextLength
    const attemptedBudget = attempted?.budgetTokens
    const currentLabel =
      currentModel?.name || currentModel?.modelName || 'current model'

    const attemptedText = attempted
      ? `Can't switch to ${attempted.name}: current ~${formatTokens(result.currentContextTokens)} tokens exceeds safe budget (~${formatTokens(attemptedBudget ?? 0)} tokens, 90% of ${formatTokens(attemptedContext ?? 0)}).`
      : `Can't switch models due to context size (~${formatTokens(result.currentContextTokens)} tokens).`

    return {
      success: false,
      modelName: null,
      blocked: true,
      message: `⚠️ ${attemptedText} Keeping ${currentLabel}.`,
    }
  }

  return {
    success: false,
    modelName: null,
    blocked: false,
    message: '❌ Failed to switch models',
  }
}
