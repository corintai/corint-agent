import { z } from 'zod'
import type { Tool, ValidationResult, ToolUseContext } from '@tool'
import { getAnalyzeDataQualityPrompt } from './prompt'
import type {
  QualityMetric,
  AnalyzeDataQualityOutput,
  ProfileResult,
  ColumnProfile,
  MissingRateResult,
  SingleValueResult,
  VarianceResult,
  EntropyResult,
} from './types'
import { validateDataSource, isValidValue } from '../shared/validation'
import { loadData, getColumnValues } from '../shared/dataLoader'
import { mean, median, std, variance, quantile } from '../shared/statistics'

export const inputSchema = z.strictObject({
  datasource: z.string().optional().describe('Name of the data source'),
  table: z.string().optional().describe('Table name (for SQL sources)'),
  filePath: z.string().optional().describe('File path (for local files)'),
  features: z
    .array(z.string())
    .optional()
    .describe('Feature column names to analyze (optional, analyzes all if not specified)'),
  metrics: z
    .array(
      z.enum([
        'profile',
        'missing',
        'single_value',
        'variance',
        'entropy',
        'quantile_collapse',
        'temporal',
        'collinearity',
      ]),
    )
    .describe('Quality metrics to compute'),
  sampleSize: z
    .number()
    .optional()
    .default(10000)
    .describe('Sample size for large datasets (default: 10000)'),
})

type Input = z.infer<typeof inputSchema>

function parseNumeric(value: unknown): number | null {
  if (!isValidValue(value)) return null
  const parsed = typeof value === 'number' ? value : parseFloat(String(value))
  if (!Number.isFinite(parsed)) return null
  return parsed
}

function inferColumnType(values: any[]): ColumnProfile['type'] {
  const validValues = values.filter(v => isValidValue(v))
  if (validValues.length === 0) return 'text'

  const numericCount = validValues.filter(
    v => typeof v === 'number' && !isNaN(v),
  ).length
  if (numericCount / validValues.length > 0.8) return 'numeric'

  const dateCount = validValues.filter(v => {
    if (typeof v === 'string') {
      const date = new Date(v)
      return !isNaN(date.getTime())
    }
    return false
  }).length
  if (dateCount / validValues.length > 0.8) return 'datetime'

  const uniqueCount = new Set(validValues).size
  if (uniqueCount < validValues.length * 0.5) return 'categorical'

  return 'text'
}

function profileColumn(columnName: string, values: any[]): ColumnProfile {
  const totalCount = values.length
  const validValues = values.filter(v => isValidValue(v))
  const missingCount = totalCount - validValues.length
  const missingRate = missingCount / totalCount

  const type = inferColumnType(values)
  const uniqueCount = new Set(validValues).size

  const profile: ColumnProfile = {
    name: columnName,
    type,
    uniqueCount,
    missingRate,
  }

  if (type === 'numeric') {
    const numericValues = validValues
      .map(v => (typeof v === 'number' ? v : parseFloat(v)))
      .filter(v => !isNaN(v))

    if (numericValues.length > 0) {
      profile.min = Math.min(...numericValues)
      profile.max = Math.max(...numericValues)
      profile.mean = mean(numericValues)
      profile.median = median(numericValues)
      profile.std = std(numericValues)
      profile.q25 = quantile(numericValues, 0.25)
      profile.q75 = quantile(numericValues, 0.75)
    }
  } else if (type === 'categorical') {
    const valueCounts = new Map<any, number>()
    validValues.forEach(v => {
      valueCounts.set(v, (valueCounts.get(v) || 0) + 1)
    })
    const sorted = Array.from(valueCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
    profile.topValues = sorted.map(([value, count]) => ({ value, count }))
  }

  return profile
}

function computeProfile(
  df: ReturnType<typeof loadData> extends Promise<infer T> ? T : never,
): ProfileResult {
  const columns = df.columns.map(col => {
    const values = getColumnValues(df, col)
    return profileColumn(col, values)
  })

  const numericColumns = columns.filter(c => c.type === 'numeric').length
  const categoricalColumns = columns.filter(c => c.type === 'categorical').length

  return {
    totalRows: df.rowCount,
    totalColumns: df.columns.length,
    numericColumns,
    categoricalColumns,
    columns,
  }
}

function computeMissingRate(
  df: ReturnType<typeof loadData> extends Promise<infer T> ? T : never,
  features: string[],
): MissingRateResult[] {
  return features.map(feature => {
    const values = getColumnValues(df, feature)
    const totalCount = values.length
    const missingCount = values.filter(v => !isValidValue(v)).length
    const missingRate = missingCount / totalCount

    let recommendation = ''
    if (missingRate > 0.5) {
      recommendation = 'High missing rate, consider removing this feature'
    } else if (missingRate > 0.2) {
      recommendation = 'Moderate missing rate, consider imputation'
    } else if (missingRate > 0) {
      recommendation = 'Low missing rate, safe to use with imputation'
    } else {
      recommendation = 'No missing values'
    }

    return {
      feature,
      missingRate,
      missingCount,
      totalCount,
      recommendation,
    }
  })
}

function computeSingleValue(
  df: ReturnType<typeof loadData> extends Promise<infer T> ? T : never,
  features: string[],
): SingleValueResult[] {
  return features.map(feature => {
    const values = getColumnValues(df, feature)
    const validValues = values.filter(v => isValidValue(v))
    const uniqueCount = new Set(validValues).size

    if (uniqueCount <= 1) {
      return {
        feature,
        isSingleValue: true,
        uniqueCount,
        dominantValue: validValues[0],
        dominantValueRate: 1.0,
      }
    }

    // Check for dominant value (>95%)
    const valueCounts = new Map<any, number>()
    validValues.forEach(v => {
      valueCounts.set(v, (valueCounts.get(v) || 0) + 1)
    })
    const maxCount = Math.max(...valueCounts.values())
    const dominantRate = maxCount / validValues.length

    if (dominantRate > 0.95) {
      const dominantValue = Array.from(valueCounts.entries()).find(
        ([_, count]) => count === maxCount,
      )?.[0]
      return {
        feature,
        isSingleValue: true,
        uniqueCount,
        dominantValue,
        dominantValueRate: dominantRate,
      }
    }

    return {
      feature,
      isSingleValue: false,
      uniqueCount,
    }
  })
}

function computeVarianceMetric(
  df: ReturnType<typeof loadData> extends Promise<infer T> ? T : never,
  features: string[],
): VarianceResult[] {
  return features.map(feature => {
    const values = getColumnValues(df, feature)
    const numericValues = values
      .map(v => parseNumeric(v))
      .filter((v): v is number => v !== null)

    if (numericValues.length === 0) {
      return {
        feature,
        variance: 0,
        std: 0,
        cv: 0,
        interpretation: 'No valid numeric values',
      }
    }

    const v = variance(numericValues)
    const s = std(numericValues)
    const m = mean(numericValues)
    const cv = m !== 0 ? s / Math.abs(m) : 0

    let interpretation = ''
    if (v === 0) {
      interpretation = 'Zero variance, consider removing'
    } else if (cv < 0.1) {
      interpretation = 'Low variability'
    } else if (cv < 0.5) {
      interpretation = 'Moderate variability'
    } else {
      interpretation = 'High variability'
    }

    return {
      feature,
      variance: v,
      std: s,
      cv,
      interpretation,
    }
  })
}

function computeEntropyMetric(
  df: ReturnType<typeof loadData> extends Promise<infer T> ? T : never,
  features: string[],
): EntropyResult[] {
  return features.map(feature => {
    const values = getColumnValues(df, feature)
    const validValues = values.filter(v => isValidValue(v))

    if (validValues.length === 0) {
      return {
        feature,
        entropy: 0,
        normalizedEntropy: 0,
        interpretation: 'No valid values',
      }
    }

    const valueCounts = new Map<any, number>()
    validValues.forEach(v => {
      valueCounts.set(v, (valueCounts.get(v) || 0) + 1)
    })

    let entropy = 0
    const total = validValues.length
    for (const count of valueCounts.values()) {
      const p = count / total
      if (p > 0) {
        entropy -= p * Math.log2(p)
      }
    }

    const maxEntropy = Math.log2(valueCounts.size)
    const normalizedEntropy = maxEntropy > 0 ? entropy / maxEntropy : 0

    let interpretation = ''
    if (normalizedEntropy < 0.3) {
      interpretation = 'Low entropy, low information content'
    } else if (normalizedEntropy < 0.7) {
      interpretation = 'Moderate entropy'
    } else {
      interpretation = 'High entropy, high information content'
    }

    return {
      feature,
      entropy,
      normalizedEntropy,
      interpretation,
    }
  })
}

export const AnalyzeDataQualityTool: Tool<typeof inputSchema, AnalyzeDataQualityOutput> = {
  name: 'AnalyzeDataQuality',
  async description() {
    return 'Analyze data quality metrics including profile, missing rates, variance, entropy, and more'
  },
  async prompt() {
    return getAnalyzeDataQualityPrompt()
  },
  isReadOnly() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  inputSchema,
  userFacingName() {
    return 'AnalyzeDataQuality'
  },
  async isEnabled() {
    return true
  },
  needsPermissions(): boolean {
    return true
  },
  async validateInput(
    { datasource, filePath }: Input,
    _context?: ToolUseContext,
  ): Promise<ValidationResult> {
    const validation = validateDataSource(datasource, filePath)
    if (!validation.valid) {
      return { result: false, message: validation.error }
    }
    return { result: true }
  },

  renderToolUseMessage(
    { datasource, table, filePath, metrics, features }: Input,
    { verbose },
  ) {
    const source = datasource ? `${datasource}.${table}` : filePath
    if (verbose) {
      return `AnalyzeDataQuality: ${source} (${metrics.length} metrics${features ? `, ${features.length} features` : ''})`
    }
    return `AnalyzeDataQuality: ${metrics.join(', ')}`
  },

  renderResultForAssistant(output: AnalyzeDataQualityOutput): string {
    const lines: string[] = ['Data Quality Analysis Results:', '']

    if (output.profile) {
      lines.push('## Dataset Profile')
      lines.push(`- Total rows: ${output.profile.totalRows}`)
      lines.push(`- Total columns: ${output.profile.totalColumns}`)
      lines.push(`- Numeric columns: ${output.profile.numericColumns}`)
      lines.push(`- Categorical columns: ${output.profile.categoricalColumns}`)
      lines.push('')
    }

    if (output.missing) {
      lines.push('## Missing Rate Analysis')
      output.missing.forEach(r => {
        const icon = r.missingRate > 0.5 ? '⚠' : r.missingRate > 0.2 ? '○' : '✓'
        lines.push(
          `  ${icon} ${r.feature}: ${(r.missingRate * 100).toFixed(1)}% (${r.missingCount}/${r.totalCount})`,
        )
        lines.push(`     ${r.recommendation}`)
      })
      lines.push('')
    }

    if (output.singleValue) {
      const problematic = output.singleValue.filter(r => r.isSingleValue)
      if (problematic.length > 0) {
        lines.push('## Single Value Detection')
        problematic.forEach(r => {
          lines.push(
            `  ⚠ ${r.feature}: ${r.uniqueCount} unique values (${(r.dominantValueRate! * 100).toFixed(1)}% dominant)`,
          )
        })
        lines.push('')
      }
    }

    if (output.variance) {
      lines.push('## Variance Analysis')
      output.variance.forEach(r => {
        lines.push(
          `  ${r.feature}: variance=${r.variance.toFixed(4)}, std=${r.std.toFixed(4)}, cv=${r.cv.toFixed(4)}`,
        )
        lines.push(`     ${r.interpretation}`)
      })
      lines.push('')
    }

    if (output.entropy) {
      lines.push('## Entropy Analysis')
      output.entropy.forEach(r => {
        lines.push(
          `  ${r.feature}: entropy=${r.entropy.toFixed(4)}, normalized=${r.normalizedEntropy.toFixed(4)}`,
        )
        lines.push(`     ${r.interpretation}`)
      })
      lines.push('')
    }

    return lines.join('\n')
  },

  async *call(
    { datasource, table, filePath, features, metrics, sampleSize }: Input,
    { abortController },
  ) {
    try {
      if (abortController.signal.aborted) {
        yield {
          type: 'result' as const,
          data: {},
          resultForAssistant: 'Operation cancelled',
        }
        return
      }

      const df = await loadData({ datasource, table, filePath, sampleSize })

      // Determine which features to analyze
      const featuresToAnalyze = features || df.columns

      // Validate features exist
      const missingFeatures = featuresToAnalyze.filter(
        f => !df.columns.includes(f),
      )
      if (missingFeatures.length > 0) {
        throw new Error(
          `Features not found in dataset: ${missingFeatures.join(', ')}`,
        )
      }

      const result: AnalyzeDataQualityOutput = {}

      // Compute requested metrics
      for (const metric of metrics) {
        switch (metric) {
          case 'profile':
            result.profile = computeProfile(df)
            break
          case 'missing':
            result.missing = computeMissingRate(df, featuresToAnalyze)
            break
          case 'single_value':
            result.singleValue = computeSingleValue(df, featuresToAnalyze)
            break
          case 'variance':
            result.variance = computeVarianceMetric(df, featuresToAnalyze)
            break
          case 'entropy':
            result.entropy = computeEntropyMetric(df, featuresToAnalyze)
            break
          case 'quantile_collapse':
            // TODO: Implement quantile collapse detection
            break
          case 'temporal':
            // TODO: Implement temporal consistency analysis
            break
          case 'collinearity':
            // TODO: Implement collinearity detection
            break
        }
      }

      yield {
        type: 'result' as const,
        data: result,
        resultForAssistant: this.renderResultForAssistant(result),
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      yield {
        type: 'result' as const,
        data: {},
        resultForAssistant: `Data quality analysis failed: ${errorMessage}`,
      }
    }
  },
}
