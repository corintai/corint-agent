export interface QuantileCollapseResult {
  feature: string
  collapseRate: number
  iqr: number
  range: number
  q25: number
  q75: number
  min: number
  max: number
  status: 'collapsed' | 'normal'
  recommendation: string
}
