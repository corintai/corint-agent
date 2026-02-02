export interface CollinearityPair {
  feature1: string
  feature2: string
  correlation: number
  recommendation: 'keep_feature1' | 'keep_feature2' | 'review'
  reason: string
}
