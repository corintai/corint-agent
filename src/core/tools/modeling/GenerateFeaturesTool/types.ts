import type { FeatureCandidate } from '../featureEngineering/shared/types'

export type FeatureType = 'window' | 'ratio' | 'cross' | 'credit'

export interface GenerationConfig {
  subjects?: string[]
  metrics?: string[]
  families?: string[]
  objects?: string[]
  events?: string[]
  dimensions?: string[]
  windows?: string[]
  includeCalculationMethods?: string[]
}

export interface GeneratedFeature {
  name: string
  description: string
  type: 'numeric' | 'categorical'
  formula: string
  reasoning?: string
}

export interface GenerateFeaturesOutput {
  outputTable?: string
  features: GeneratedFeature[]
  statistics: {
    totalGenerated: number
    byType: Record<FeatureType, number>
    executionTime: number
  }
}
