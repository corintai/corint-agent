export interface TemporalConsistencyResult {
  feature: string
  correlation: number
  shortWindowMean: number
  longWindowMean: number
  shortWindowStd: number
  longWindowStd: number
  status: 'inconsistent' | 'consistent'
  recommendation: string
}
