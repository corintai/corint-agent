import { memoize } from 'lodash-es'

import { logError } from '@utils/log'
import { debug as debugLogger } from '@utils/log/debugLogger'
import {
  DEFAULT_GLOBAL_CONFIG,
  getGlobalConfig,
  GlobalConfig,
  ModelProfile,
  ModelPointerType,
  saveGlobalConfig,
} from '@utils/config'
import { GLOBAL_CONFIG_FILE } from '@utils/config/env'
import {
  switchToNextModel as switchToNextModelInternal,
  switchToNextModelWithContextCheck as switchToNextModelWithContextCheckInternal,
  type SwitchResult,
  type SwitchWithContextResult,
} from './modelSwitching'

export const USE_BEDROCK = !!(
  process.env.CORINT_USE_BEDROCK ?? process.env.CLAUDE_CODE_USE_BEDROCK
)
export const USE_VERTEX = !!(
  process.env.CORINT_USE_VERTEX ?? process.env.CLAUDE_CODE_USE_VERTEX
)

export interface ModelConfig {
  bedrock: string
  vertex: string
  firstParty: string
}

const DEFAULT_MODEL_CONFIG: ModelConfig = {
  bedrock: 'us.anthropic.claude-3-7-sonnet-20250219-v1:0',
  vertex: 'claude-3-7-sonnet@20250219',
  firstParty: 'claude-sonnet-4-20250514',
}

const buildFallbackConfig = (): GlobalConfig => ({
  ...DEFAULT_GLOBAL_CONFIG,
  modelProfiles: [],
  modelPointers: { ...DEFAULT_GLOBAL_CONFIG.modelPointers },
})

async function getModelConfig(): Promise<ModelConfig> {
  return DEFAULT_MODEL_CONFIG
}

export const getSlowAndCapableModel = memoize(async (): Promise<string> => {
  const config = await getGlobalConfig()

  const modelManager = new ModelManager(config)
  const model = modelManager.getMainAgentModel()

  if (model) {
    return model
  }

  const modelConfig = await getModelConfig()
  if (USE_BEDROCK) return modelConfig.bedrock
  if (USE_VERTEX) return modelConfig.vertex
  return modelConfig.firstParty
})

export async function isDefaultSlowAndCapableModel(): Promise<boolean> {
  return (
    !process.env.ANTHROPIC_MODEL ||
    process.env.ANTHROPIC_MODEL === (await getSlowAndCapableModel())
  )
}

export function getVertexRegionForModel(
  model: string | undefined,
): string | undefined {
  if (model?.startsWith('claude-3-5-haiku')) {
    return process.env.VERTEX_REGION_CLAUDE_3_5_HAIKU
  } else if (model?.startsWith('claude-3-5-sonnet')) {
    return process.env.VERTEX_REGION_CLAUDE_3_5_SONNET
  } else if (model?.startsWith('claude-3-7-sonnet')) {
    return process.env.VERTEX_REGION_CLAUDE_3_7_SONNET
  }
}

export class ModelManager {
  private config: GlobalConfig
  private modelProfiles: ModelProfile[]

  constructor(config: GlobalConfig) {
    this.config = config
    this.modelProfiles = config.modelProfiles || []
  }

  getCurrentModel(): string | null {
    const mainModelName = this.config.modelPointers?.main
    if (mainModelName) {
      const profile = this.findModelProfile(mainModelName)
      if (profile && profile.isActive) {
        return profile.modelName
      }
    }

    return this.getMainAgentModel()
  }

  getMainAgentModel(): string | null {
    const mainModelName = this.config.modelPointers?.main
    if (mainModelName) {
      const profile = this.findModelProfile(mainModelName)
      if (profile && profile.isActive) {
        return profile.modelName
      }
    }

    const activeProfile = this.modelProfiles.find(p => p.isActive)
    if (activeProfile) {
      return activeProfile.modelName
    }

    return null
  }

  getTaskToolModel(): string | null {
    const taskModelName = this.config.modelPointers?.task
    if (taskModelName) {
      const profile = this.findModelProfile(taskModelName)
      if (profile && profile.isActive) {
        return profile.modelName
      }
    }

    return this.getMainAgentModel()
  }

  switchToNextModelWithContextCheck(
    currentContextTokens: number = 0,
  ): SwitchWithContextResult {
    return switchToNextModelWithContextCheckInternal({
      allProfiles: this.getAllConfiguredModels(),
      currentMainModelName: this.config.modelPointers?.main,
      currentContextTokens,
      setPointer: this.setPointer.bind(this),
      updateLastUsed: this.updateLastUsed.bind(this),
      findModelProfile: this.findModelProfile.bind(this),
    })
  }

  switchToNextModel(currentContextTokens: number = 0): SwitchResult {
    return switchToNextModelInternal({
      allProfiles: this.getAllConfiguredModels(),
      currentMainModelName: this.config.modelPointers?.main,
      currentContextTokens,
      setPointer: this.setPointer.bind(this),
      updateLastUsed: this.updateLastUsed.bind(this),
      findModelProfile: this.findModelProfile.bind(this),
    })
  }

  revertToPreviousModel(previousModelName: string): boolean {
    const previousModel = this.modelProfiles.find(
      p => p.name === previousModelName && p.isActive,
    )
    if (!previousModel) {
      return false
    }

    this.setPointer('main', previousModel.modelName)
    this.updateLastUsed(previousModel.modelName)
    return true
  }

  analyzeContextCompatibility(
    model: ModelProfile,
    contextTokens: number,
  ): {
    compatible: boolean
    severity: 'safe' | 'warning' | 'critical'
    usagePercentage: number
    recommendation: string
  } {
    const usableContext = Math.floor(model.contextLength * 0.8)
    const usagePercentage = (contextTokens / usableContext) * 100

    if (usagePercentage <= 70) {
      return {
        compatible: true,
        severity: 'safe',
        usagePercentage,
        recommendation: 'Full context preserved',
      }
    } else if (usagePercentage <= 90) {
      return {
        compatible: true,
        severity: 'warning',
        usagePercentage,
        recommendation: 'Context usage high, consider compression',
      }
    } else {
      return {
        compatible: false,
        severity: 'critical',
        usagePercentage,
        recommendation: 'Auto-compression or message truncation required',
      }
    }
  }

  switchToNextModelWithAnalysis(currentContextTokens: number = 0): {
    modelName: string | null
    contextAnalysis: ReturnType<typeof this.analyzeContextCompatibility> | null
    requiresCompression: boolean
    estimatedTokensAfterSwitch: number
  } {
    const result = this.switchToNextModel(currentContextTokens)

    if (!result.success || !result.modelName) {
      return {
        modelName: null,
        contextAnalysis: null,
        requiresCompression: false,
        estimatedTokensAfterSwitch: 0,
      }
    }

    const newModel = this.getModel('main')
    if (!newModel) {
      return {
        modelName: result.modelName,
        contextAnalysis: null,
        requiresCompression: false,
        estimatedTokensAfterSwitch: currentContextTokens,
      }
    }

    const analysis = this.analyzeContextCompatibility(
      newModel,
      currentContextTokens,
    )

    return {
      modelName: result.modelName,
      contextAnalysis: analysis,
      requiresCompression: analysis.severity === 'critical',
      estimatedTokensAfterSwitch: currentContextTokens,
    }
  }

  canModelHandleContext(model: ModelProfile, contextTokens: number): boolean {
    const analysis = this.analyzeContextCompatibility(model, contextTokens)
    return analysis.compatible
  }

  findModelWithSufficientContext(
    models: ModelProfile[],
    contextTokens: number,
  ): ModelProfile | null {
    return (
      models.find(model => this.canModelHandleContext(model, contextTokens)) ||
      null
    )
  }

  getModelForContext(
    contextType: 'terminal' | 'main-agent' | 'task-tool',
  ): string | null {
    switch (contextType) {
      case 'terminal':
        return this.getCurrentModel()
      case 'main-agent':
        return this.getMainAgentModel()
      case 'task-tool':
        return this.getTaskToolModel()
      default:
        return this.getMainAgentModel()
    }
  }

  getActiveModelProfiles(): ModelProfile[] {
    return this.modelProfiles.filter(p => p.isActive)
  }

  hasConfiguredModels(): boolean {
    return this.getActiveModelProfiles().length > 0
  }

  getModel(pointer: ModelPointerType): ModelProfile | null {
    const pointerId = this.config.modelPointers?.[pointer]
    if (!pointerId) {
      return this.getDefaultModel()
    }

    const profile = this.findModelProfile(pointerId)
    return profile && profile.isActive ? profile : this.getDefaultModel()
  }

  getModelName(pointer: ModelPointerType): string | null {
    const profile = this.getModel(pointer)
    return profile ? profile.modelName : null
  }

  getCompactModel(): string | null {
    return this.getModelName('compact') || this.getModelName('main')
  }

  getQuickModel(): string | null {
    return (
      this.getModelName('quick') ||
      this.getModelName('task') ||
      this.getModelName('main')
    )
  }

  async addModel(
    config: Omit<ModelProfile, 'createdAt' | 'isActive'>,
  ): Promise<string> {
    const existingByModelName = this.modelProfiles.find(
      p => p.modelName === config.modelName,
    )
    if (existingByModelName) {
      throw new Error(
        `Model with modelName '${config.modelName}' already exists: ${existingByModelName.name}`,
      )
    }

    const existingByName = this.modelProfiles.find(p => p.name === config.name)
    if (existingByName) {
      throw new Error(`Model with name '${config.name}' already exists`)
    }

    const newModel: ModelProfile = {
      ...config,
      createdAt: Date.now(),
      isActive: true,
    }

    this.modelProfiles.push(newModel)

    if (this.modelProfiles.length === 1) {
      this.config.modelPointers = {
        main: config.modelName,
        task: config.modelName,
        compact: config.modelName,
        quick: config.modelName,
      }
      this.config.defaultModelName = config.modelName
    } else {
      if (!this.config.modelPointers) {
        this.config.modelPointers = {
          main: config.modelName,
          task: '',
          compact: '',
          quick: '',
        }
      } else {
        this.config.modelPointers.main = config.modelName
      }
    }

    this.saveConfig()
    return config.modelName
  }

  setPointer(pointer: ModelPointerType, modelName: string): void {
    if (!this.findModelProfile(modelName)) {
      throw new Error(`Model '${modelName}' not found`)
    }

    if (!this.config.modelPointers) {
      this.config.modelPointers = {
        main: '',
        task: '',
        compact: '',
        quick: '',
      }
    }

    this.config.modelPointers[pointer] = modelName
    this.saveConfig()
  }

  getAvailableModels(): ModelProfile[] {
    return this.modelProfiles.filter(p => p.isActive)
  }

  getAllConfiguredModels(): ModelProfile[] {
    return this.modelProfiles
  }

  getAllAvailableModelNames(): string[] {
    return this.getAvailableModels().map(p => p.modelName)
  }

  getAllConfiguredModelNames(): string[] {
    return this.getAllConfiguredModels().map(p => p.modelName)
  }

  getModelSwitchingDebugInfo(): {
    totalModels: number
    activeModels: number
    inactiveModels: number
    currentMainModel: string | null
    availableModels: Array<{
      name: string
      modelName: string
      provider: string
      isActive: boolean
      lastUsed?: number
    }>
    modelPointers: Record<string, string | undefined>
  } {
    const availableModels = this.getAvailableModels()
    const currentMainModelName = this.config.modelPointers?.main

    return {
      totalModels: this.modelProfiles.length,
      activeModels: availableModels.length,
      inactiveModels: this.modelProfiles.length - availableModels.length,
      currentMainModel: currentMainModelName || null,
      availableModels: this.modelProfiles.map(p => ({
        name: p.name,
        modelName: p.modelName,
        provider: p.provider,
        isActive: p.isActive,
        lastUsed: p.lastUsed,
      })),
      modelPointers: this.config.modelPointers || {},
    }
  }

  removeModel(modelName: string): void {
    this.modelProfiles = this.modelProfiles.filter(
      p => p.modelName !== modelName,
    )

    if (this.config.modelPointers) {
      Object.keys(this.config.modelPointers).forEach(pointer => {
        if (
          this.config.modelPointers[pointer as ModelPointerType] === modelName
        ) {
          this.config.modelPointers[pointer as ModelPointerType] =
            this.config.defaultModelName || ''
        }
      })
    }

    this.saveConfig()
  }

  private getDefaultModel(): ModelProfile | null {
    if (this.config.defaultModelName) {
      const profile = this.findModelProfile(this.config.defaultModelName)
      if (profile && profile.isActive) {
        return profile
      }
    }
    return this.modelProfiles.find(p => p.isActive) || null
  }

  private saveConfig(): void {
    const updatedConfig = {
      ...this.config,
      modelProfiles: this.modelProfiles,
    }
    saveGlobalConfig(updatedConfig)
  }

  async getFallbackModel(): Promise<string> {
    const modelConfig = await getModelConfig()
    if (USE_BEDROCK) return modelConfig.bedrock
    if (USE_VERTEX) return modelConfig.vertex
    return modelConfig.firstParty
  }

  resolveModel(modelParam: string | ModelPointerType): ModelProfile | null {
    if (['main', 'task', 'compact', 'quick'].includes(modelParam)) {
      const pointerId =
        this.config.modelPointers?.[modelParam as ModelPointerType]
      if (pointerId) {
        let profile = this.findModelProfile(pointerId)
        if (!profile) {
          profile = this.findModelProfileByModelName(pointerId)
        }
        if (profile && profile.isActive) {
          return profile
        }
      }
      return this.getDefaultModel()
    }

    let profile = this.findModelProfile(modelParam)
    if (profile && profile.isActive) {
      return profile
    }

    profile = this.findModelProfileByModelName(modelParam)
    if (profile && profile.isActive) {
      return profile
    }

    profile = this.findModelProfileByName(modelParam)
    if (profile && profile.isActive) {
      return profile
    }

    if (typeof modelParam === 'string') {
      const qualified = this.resolveProviderQualifiedModel(modelParam)
      if (qualified && qualified.isActive) {
        return qualified
      }
    }

    return this.getDefaultModel()
  }

  resolveModelWithInfo(modelParam: string | ModelPointerType): {
    success: boolean
    profile: ModelProfile | null
    error?: string
  } {
    const isPointer = ['main', 'task', 'compact', 'quick'].includes(modelParam)

    if (isPointer) {
      const pointerId =
        this.config.modelPointers?.[modelParam as ModelPointerType]
      if (!pointerId) {
        return {
          success: false,
          profile: null,
          error: `Model pointer '${modelParam}' is not configured. Use /model to select a configured model or update ${GLOBAL_CONFIG_FILE}.`,
        }
      }

      let profile = this.findModelProfile(pointerId)
      if (!profile) {
        profile = this.findModelProfileByModelName(pointerId)
      }

      if (!profile) {
        return {
          success: false,
          profile: null,
          error: `Model pointer '${modelParam}' points to invalid model '${pointerId}'. Update ${GLOBAL_CONFIG_FILE} or select a configured model with /model.`,
        }
      }

      if (!profile.isActive) {
        return {
          success: false,
          profile: null,
          error: `Model '${profile.name}' (pointed by '${modelParam}') is inactive. Set isActive=true in ${GLOBAL_CONFIG_FILE}.`,
        }
      }

      return {
        success: true,
        profile,
      }
    } else {
      let profile = this.findModelProfile(modelParam)
      if (!profile) {
        profile = this.findModelProfileByModelName(modelParam)
      }
      if (!profile) {
        profile = this.findModelProfileByName(modelParam)
      }

      if (!profile && typeof modelParam === 'string') {
        profile = this.resolveProviderQualifiedModel(modelParam)
      }

      if (!profile) {
        return {
          success: false,
          profile: null,
          error: `Model '${modelParam}' not found. Check ${GLOBAL_CONFIG_FILE} or run 'kode models list' to see configured profiles.`,
        }
      }

      if (!profile.isActive) {
        return {
          success: false,
          profile: null,
          error: `Model '${profile.name}' is inactive. Set isActive=true in ${GLOBAL_CONFIG_FILE}.`,
        }
      }

      return {
        success: true,
        profile,
      }
    }
  }

  private resolveProviderQualifiedModel(input: string): ModelProfile | null {
    const trimmed = input.trim()
    const colonIndex = trimmed.indexOf(':')
    if (colonIndex <= 0 || colonIndex >= trimmed.length - 1) return null

    const provider = trimmed.slice(0, colonIndex).trim().toLowerCase()
    const modelOrName = trimmed.slice(colonIndex + 1).trim()
    if (!provider || !modelOrName) return null

    const providerProfiles = this.modelProfiles.filter(
      p => String(p.provider).trim().toLowerCase() === provider,
    )
    if (providerProfiles.length === 0) return null

    const byModelName = providerProfiles.find(p => p.modelName === modelOrName)
    if (byModelName) return byModelName

    const byName = providerProfiles.find(p => p.name === modelOrName)
    if (byName) return byName

    return null
  }

  private findModelProfile(modelName: string): ModelProfile | null {
    return this.modelProfiles.find(p => p.modelName === modelName) || null
  }

  private findModelProfileByModelName(modelName: string): ModelProfile | null {
    return this.modelProfiles.find(p => p.modelName === modelName) || null
  }

  private findModelProfileByName(name: string): ModelProfile | null {
    return this.modelProfiles.find(p => p.name === name) || null
  }

  private updateLastUsed(modelName: string): void {
    const profile = this.findModelProfile(modelName)
    if (profile) {
      profile.lastUsed = Date.now()
    }
  }
}

let globalModelManager: ModelManager | null = null

export const getModelManager = (): ModelManager => {
  try {
    if (!globalModelManager) {
      const config = getGlobalConfig()
      if (!config) {
        debugLogger.warn('MODEL_MANAGER_GLOBAL_CONFIG_MISSING', {})
        globalModelManager = new ModelManager(buildFallbackConfig())
      } else {
        globalModelManager = new ModelManager(config)
      }
    }
    return globalModelManager
  } catch (error) {
    logError(error)
    debugLogger.error('MODEL_MANAGER_CREATE_FAILED', {
      error: error instanceof Error ? error.message : String(error),
    })
    return new ModelManager(buildFallbackConfig())
  }
}

export const reloadModelManager = (): void => {
  globalModelManager = null
  getModelManager()
}

export const getQuickModel = (): string => {
  const manager = getModelManager()
  const quickModel = manager.getModel('quick')
  return quickModel?.modelName || 'quick'
}
