import type { IvResult, WoeBin, PsiResult, CoverageResult } from '../shared/types'

export type EvaluationMetric = 'iv' | 'psi' | 'coverage'

export interface EvaluateFeaturesOutput {
  iv?: {
    results: IvResult[]
    woe: {
      feature: string
      bins: WoeBin[]
    }[]
    summary: {
      totalFeatures: number
      strongFeatures: string[]
      weakFeatures: string[]
      suspiciousFeatures: string[]
      skippedFeatures: string[]
    }
  }
  psi?: {
    results: PsiResult[]
    summary: {
      totalFeatures: number
      stableFeatures: string[]
      warningFeatures: string[]
      driftFeatures: string[]
    }
  }
  coverage?: {
    results: CoverageResult[]
    summary: {
      totalFeatures: number
      goodFeatures: string[]
      warningFeatures: string[]
      poorFeatures: string[]
    }
  }
}
