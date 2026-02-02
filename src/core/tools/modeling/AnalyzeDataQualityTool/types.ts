export type QualityMetric =
  | 'profile'
  | 'missing'
  | 'single_value'
  | 'variance'
  | 'entropy'
  | 'quantile_collapse'
  | 'temporal'
  | 'collinearity'

export interface ColumnProfile {
  name: string
  type: 'numeric' | 'categorical' | 'datetime' | 'text'
  uniqueCount: number
  missingRate: number
  min?: number
  max?: number
  mean?: number
  median?: number
  std?: number
  q25?: number
  q75?: number
  topValues?: Array<{ value: any; count: number }>
}

export interface ProfileResult {
  totalRows: number
  totalColumns: number
  numericColumns: number
  categoricalColumns: number
  columns: ColumnProfile[]
}

export interface MissingRateResult {
  feature: string
  missingRate: number
  missingCount: number
  totalCount: number
  recommendation: string
}

export interface SingleValueResult {
  feature: string
  isSingleValue: boolean
  uniqueCount: number
  dominantValue?: any
  dominantValueRate?: number
}

export interface VarianceResult {
  feature: string
  variance: number
  std: number
  cv: number // coefficient of variation
  interpretation: string
}

export interface EntropyResult {
  feature: string
  entropy: number
  normalizedEntropy: number
  interpretation: string
}

export interface QuantileCollapseResult {
  feature: string
  hasCollapse: boolean
  collapseRate: number
  affectedQuantiles: string[]
  recommendation: string
}

export interface TemporalConsistencyResult {
  feature: string
  isConsistent: boolean
  inconsistencyRate: number
  periods: Array<{
    period: string
    mean: number
    std: number
  }>
  recommendation: string
}

export interface CollinearityResult {
  feature1: string
  feature2: string
  correlation: number
  interpretation: string
}

export interface AnalyzeDataQualityOutput {
  profile?: ProfileResult
  missing?: MissingRateResult[]
  singleValue?: SingleValueResult[]
  variance?: VarianceResult[]
  entropy?: EntropyResult[]
  quantileCollapse?: QuantileCollapseResult[]
  temporal?: TemporalConsistencyResult[]
  collinearity?: CollinearityResult[]
}
