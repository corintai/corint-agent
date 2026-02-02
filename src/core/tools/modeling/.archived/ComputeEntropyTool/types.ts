export interface EntropyResult {
  feature: string
  entropy: number
  bins: number
  uniqueValues: number
  status: 'low_entropy' | 'normal'
  recommendation: string
}
