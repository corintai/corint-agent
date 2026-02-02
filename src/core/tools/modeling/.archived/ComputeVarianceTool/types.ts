export interface VarianceResult {
  feature: string
  variance: number
  std: number
  mean: number
  status: 'constant' | 'low_variance' | 'normal'
  recommendation: string
}
