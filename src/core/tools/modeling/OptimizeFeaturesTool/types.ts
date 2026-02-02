import type { FeatureCandidate } from '../featureEngineering/shared/types'

export type OptimizationMethod = 'semantic_pruning' | 'proxy_eval' | 'beam_search'

export interface OptimizedFeature extends FeatureCandidate {
  score?: number
  rank?: number
  selected: boolean
  reason?: string
}

export interface OptimizeFeaturesOutput {
  optimizedFeatures: OptimizedFeature[]
  summary: {
    totalInput: number
    totalOutput: number
    reductionRate: number
    method: OptimizationMethod
    executionTime: number
  }
  reasoning?: string
}
