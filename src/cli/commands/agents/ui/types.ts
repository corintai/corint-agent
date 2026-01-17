import type { AgentConfig, AgentSource } from '@utils/agent/loader'
import type { AgentColor } from './constants'

export type AgentSourceFilter =
  | 'all'
  | 'built-in'
  | 'userSettings'
  | 'projectSettings'
  | 'policySettings'
  | 'flagSettings'
  | 'plugin'

export type AgentWithOverride = AgentConfig & { overriddenBy?: AgentSource }

export type WizardLocation = 'projectSettings' | 'userSettings'
export type WizardMethod = 'generate' | 'manual'

export type WizardFinalAgent = {
  agentType: string
  whenToUse: string
  systemPrompt: string
  tools: string[] | undefined
  model: string
  color?: AgentColor
  source: WizardLocation
}

export type WizardData = {
  location?: WizardLocation
  method?: WizardMethod
  generationPrompt?: string
  agentType?: string
  whenToUse?: string
  systemPrompt?: string
  selectedTools?: string[] | undefined
  selectedModel?: string
  selectedColor?: AgentColor
  wasGenerated?: boolean
  isGenerating?: boolean
  finalAgent?: WizardFinalAgent
}

export type WizardContextValue = {
  stepIndex: number
  totalSteps: number
  wizardData: WizardData
  updateWizardData: (patch: Partial<WizardData>) => void
  goNext: () => void
  goBack: () => void
  goToStep: (index: number) => void
  cancel: () => void
  done: () => void
}

export type ModeState =
  | { mode: 'list-agents'; source: AgentSourceFilter }
  | {
      mode: 'create-agent'
      previousMode: { mode: 'list-agents'; source: AgentSourceFilter }
    }
  | {
      mode: 'agent-menu'
      agent: AgentWithOverride
      previousMode: { mode: 'list-agents'; source: AgentSourceFilter }
    }
  | {
      mode: 'view-agent'
      agent: AgentWithOverride
      previousMode: {
        mode: 'agent-menu'
        agent: AgentWithOverride
        previousMode: { mode: 'list-agents'; source: AgentSourceFilter }
      }
    }
  | {
      mode: 'edit-agent'
      agent: AgentWithOverride
      previousMode: {
        mode: 'agent-menu'
        agent: AgentWithOverride
        previousMode: { mode: 'list-agents'; source: AgentSourceFilter }
      }
    }
  | {
      mode: 'delete-confirm'
      agent: AgentWithOverride
      previousMode: {
        mode: 'agent-menu'
        agent: AgentWithOverride
        previousMode: { mode: 'list-agents'; source: AgentSourceFilter }
      }
    }
