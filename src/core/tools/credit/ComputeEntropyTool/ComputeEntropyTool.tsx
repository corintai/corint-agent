import { z } from 'zod'
import type { Tool, ValidationResult, ToolUseContext } from '@tool'
import { getComputeEntropyPrompt } from './prompt'
import type { EntropyResult } from './types'
import { validateDataSource, isValidValue } from '../shared/validation'
import { loadData, getColumnValues } from '../shared/dataLoader'
import { createBins } from '../shared/binning'

export const inputSchema = z.strictObject({
  datasource: z.string().optional().describe('Name of the data source'),
  table: z.string().optional().describe('Table name (for SQL sources)'),
  filePath: z.string().optional().describe('File path (for local files)'),
  features: z.array(z.string()).describe('Feature column names'),
  bins: z
    .number()
    .optional()
    .default(10)
    .describe('Number of bins for numeric features (default: 10)'),
  threshold: z
    .number()
    .optional()
    .default(1.0)
    .describe('Low entropy threshold (default: 1.0)'),
})

type Input = z.infer<typeof inputSchema>
type Output = {
  entropy: EntropyResult[]
  summary: {
    totalFeatures: number
    lowEntropyCount: number
    normalCount: number
    lowEntropyFeatures: string[]
    avgEntropy: number
  }
}

function parseNumeric(value: unknown): number | null {
  if (!isValidValue(value)) return null
  const parsed = typeof value === 'number' ? value : parseFloat(String(value))
  if (!Number.isFinite(parsed)) return null
  return parsed
}

function computeEntropy(distribution: number[]): number {
  const total = distribution.reduce((sum, count) => sum + count, 0)
  if (total === 0) return 0

  let entropy = 0
  for (const count of distribution) {
    if (count > 0) {
      const p = count / total
      entropy -= p * Math.log2(p)
    }
  }
  return entropy
}

function getEntropyStatus(
  entropy: number,
  threshold: number,
): 'low_entropy' | 'normal' {
  return entropy < threshold ? 'low_entropy' : 'normal'
}

function getRecommendation(status: 'low_entropy' | 'normal'): string {
  return status === 'low_entropy'
    ? 'Review - low information content, concentrated distribution'
    : 'Keep - normal entropy'
}

export const ComputeEntropyTool: Tool<typeof inputSchema, Output> = {
  name: 'ComputeEntropy',
  async description() {
    return 'Calculate Shannon entropy to measure feature information content'
  },
  async prompt() {
    return getComputeEntropyPrompt()
  },
  isReadOnly() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  inputSchema,
  userFacingName() {
    return 'ComputeEntropy'
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
    return validateDataSource(datasource, filePath)
  },
  async execute(input: Input, _context?: ToolUseContext): Promise<Output> {
    const { datasource, table, filePath, features, bins = 10, threshold = 1.0 } = input

    // Load data
    const data = await loadData({ datasource, table, filePath })

    const results: EntropyResult[] = []
    let lowEntropyCount = 0
    let normalCount = 0
    const lowEntropyFeatures: string[] = []
    let totalEntropy = 0

    for (const feature of features) {
      const values = getColumnValues(data, feature)
      const validValues = values.filter(v => isValidValue(v))

      if (validValues.length === 0) {
        results.push({
          feature,
          entropy: 0,
          bins: 0,
          uniqueValues: 0,
          status: 'low_entropy',
          recommendation: 'Drop - no valid values',
        })
        lowEntropyCount++
        lowEntropyFeatures.push(feature)
        continue
      }

      // Try to parse as numeric
      const numericValues = validValues.map(parseNumeric).filter((v): v is number => v !== null)

      let distribution: number[]
      let binsUsed: number
      let uniqueValues: number

      if (numericValues.length > validValues.length * 0.8) {
        // Numeric feature - use binning
        const binResult = createBins(numericValues, bins, 'quantile')
        distribution = new Array(bins).fill(0)
        numericValues.forEach(v => {
          const binIndex = binResult.bins.findIndex(
            bin => v >= bin.lower && v <= bin.upper,
          )
          if (binIndex >= 0) {
            distribution[binIndex]++
          }
        })
        binsUsed = bins
        uniqueValues = new Set(numericValues).size
      } else {
        // Categorical feature - use actual values
        const valueCounts = new Map<any, number>()
        validValues.forEach(v => {
          valueCounts.set(v, (valueCounts.get(v) || 0) + 1)
        })
        distribution = Array.from(valueCounts.values())
        binsUsed = distribution.length
        uniqueValues = valueCounts.size
      }

      const entropy = computeEntropy(distribution)
      const status = getEntropyStatus(entropy, threshold)
      const recommendation = getRecommendation(status)

      results.push({
        feature,
        entropy,
        bins: binsUsed,
        uniqueValues,
        status,
        recommendation,
      })

      totalEntropy += entropy

      if (status === 'low_entropy') {
        lowEntropyCount++
        lowEntropyFeatures.push(feature)
      } else {
        normalCount++
      }
    }

    return {
      entropy: results,
      summary: {
        totalFeatures: features.length,
        lowEntropyCount,
        normalCount,
        lowEntropyFeatures,
        avgEntropy: features.length > 0 ? totalEntropy / features.length : 0,
      },
    }
  },
}
