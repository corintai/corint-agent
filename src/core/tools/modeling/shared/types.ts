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
  topValues?: { value: any; count: number; percentage: number }[]
}

export interface DatasetProfile {
  rowCount: number
  columnCount: number
  columns: ColumnProfile[]
  memoryUsage: string
  samplingApplied: boolean
}

export interface MissingRateResult {
  column: string
  missingRate: number
  missingCount: number
  totalCount: number
  status: 'good' | 'warning' | 'critical'
}

export interface PsiResult {
  column: string
  psiValue: number
  status: 'stable' | 'warning' | 'drift'
  interpretation: string
}

export interface PsiBinDetail {
  range: string
  baselinePct: number
  currentPct: number
  contribution: number
}

export interface IvResult {
  feature: string
  ivValue: number
  predictivePower: 'weak' | 'medium' | 'strong' | 'suspicious'
  recommendation: string
}

export interface WoeBin {
  range: string
  woe: number
  iv: number
  goodCount: number
  badCount: number
  goodRate: number
  badRate: number
}

export interface CoverageResult {
  feature: string
  coverageRate: number
  validCount: number
  totalCount: number
  status: 'good' | 'warning' | 'poor'
  recommendation: string
}

export interface SingleValueResult {
  feature: string
  dominantValue: any
  dominantRate: number
  uniqueCount: number
  recommendation: 'drop' | 'review'
  reason: string
}

export interface Bin {
  range: string
  min: number
  max: number
  count: number
  percentage: number
}

export interface BinningOptions {
  method: 'quantile' | 'equal_width' | 'tree'
  bins: number
}
