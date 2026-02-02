import { z } from 'zod'
import type { Tool, ValidationResult, ToolUseContext } from '@tool'
import { getComputeTemporalConsistencyPrompt } from './prompt'
import type { TemporalConsistencyResult } from './types'
import { validateDataSource, isValidValue } from '../shared/validation'
import { loadData, getColumnValues } from '../shared/dataLoader'
import { mean, std } from '../shared/statistics'

export const inputSchema = z.strictObject({
  datasource: z.string().optional().describe('Name of the data source'),
  table: z.string().optional().describe('Table name (for SQL sources)'),
  filePath: z.string().optional().describe('File path (for local files)'),
  features: z.array(z.string()).describe('Feature column names (numeric only)'),
  timeColumn: z.string().describe('Timestamp column name'),
  shortWindow: z
    .number()
    .optional()
    .default(30)
    .describe('Short time window in days (default: 30)'),
  longWindow: z
    .number()
    .optional()
    .default(60)
    .describe('Long time window in days (default: 60)'),
  threshold: z
    .number()
    .optional()
    .default(0.3)
    .describe('Consistency threshold (default: 0.3)'),
})

type Input = z.infer<typeof inputSchema>
type Output = {
  temporalConsistency: TemporalConsistencyResult[]
  summary: {
    totalFeatures: number
    inconsistentCount: number
    consistentCount: number
    inconsistentFeatures: string[]
    avgCorrelation: number
  }
}

function parseNumeric(value: unknown): number | null {
  if (!isValidValue(value)) return null
  const parsed = typeof value === 'number' ? value : parseFloat(String(value))
  if (!Number.isFinite(parsed)) return null
  return parsed
}

function parseDate(value: unknown): Date | null {
  if (!isValidValue(value)) return null
  const date = new Date(String(value))
  return isNaN(date.getTime()) ? null : date
}

function pearsonCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length === 0) return 0

  const n = x.length
  const meanX = mean(x)
  const meanY = mean(y)

  let numerator = 0
  let denomX = 0
  let denomY = 0

  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX
    const dy = y[i] - meanY
    numerator += dx * dy
    denomX += dx * dx
    denomY += dy * dy
  }

  if (denomX === 0 || denomY === 0) return 0
  return numerator / Math.sqrt(denomX * denomY)
}

function getConsistencyStatus(
  correlation: number,
  threshold: number,
): 'inconsistent' | 'consistent' {
  return Math.abs(correlation) < threshold ? 'inconsistent' : 'consistent'
}

function getRecommendation(status: 'inconsistent' | 'consistent'): string {
  return status === 'inconsistent'
    ? 'Review - unstable over time, may not generalize well'
    : 'Keep - consistent across time windows'
}

export const ComputeTemporalConsistencyTool: Tool<typeof inputSchema, Output> = {
  name: 'ComputeTemporalConsistency',
  async description() {
    return 'Calculate temporal consistency by comparing distributions across time windows'
  },
  async prompt() {
    return getComputeTemporalConsistencyPrompt()
  },
  isReadOnly() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  inputSchema,
  userFacingName() {
    return 'ComputeTemporalConsistency'
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
    { datasource, table, filePath, features, timeColumn }: Input,
    { verbose },
  ) {
    const source = datasource ? `${datasource}.${table}` : filePath
    if (verbose) {
      return `ComputeTemporalConsistency: ${source} (${features.length} features, time=${timeColumn})`
    }
    return 'ComputeTemporalConsistency'
  },
  renderResultForAssistant(output: Output): string {
    return [
      `Temporal Consistency Analysis:`,
      `- Inconsistent: ${output.summary.inconsistentCount}/${output.summary.totalFeatures}`,
      `- Avg correlation: ${output.summary.avgCorrelation.toFixed(3)}`,
    ].join('\n')
  },
  async *call(input: Input, { abortController }) {
    if (abortController.signal.aborted) {
      const emptyResult: Output = {
        temporalConsistency: [],
        summary: {
          totalFeatures: 0,
          inconsistentCount: 0,
          consistentCount: 0,
          inconsistentFeatures: [],
          avgCorrelation: 0,
        },
      }
      yield {
        type: 'result' as const,
        data: emptyResult,
        resultForAssistant: 'Operation cancelled',
      }
      return
    }

    const {
      datasource,
      table,
      filePath,
      features,
      timeColumn,
      shortWindow = 30,
      longWindow = 60,
      threshold = 0.3,
    } = input

    // Load data
    try {
      const data = await loadData({ datasource, table, filePath })

      // Parse timestamps
      const timestamps = getColumnValues(data, timeColumn)
        .map(parseDate)
        .filter((d): d is Date => d !== null)

      if (timestamps.length === 0) {
        throw new Error(`No valid timestamps found in column: ${timeColumn}`)
      }

      const maxDate = new Date(Math.max(...timestamps.map(d => d.getTime())))
      const shortWindowStart = new Date(
        maxDate.getTime() - shortWindow * 24 * 60 * 60 * 1000,
      )
      const longWindowStart = new Date(
        maxDate.getTime() - longWindow * 24 * 60 * 60 * 1000,
      )

      const results: TemporalConsistencyResult[] = []
      let inconsistentCount = 0
      let consistentCount = 0
      const inconsistentFeatures: string[] = []
      let totalCorrelation = 0

      for (const feature of features) {
        const featureValues = getColumnValues(data, feature)
        const timeValues = getColumnValues(data, timeColumn)

        // Split into short and long windows
        const shortWindowValues: number[] = []
        const longWindowValues: number[] = []

        for (let i = 0; i < timeValues.length; i++) {
          const date = parseDate(timeValues[i])
          const value = parseNumeric(featureValues[i])

          if (date && value !== null) {
            if (date >= shortWindowStart) {
              shortWindowValues.push(value)
            }
            if (date >= longWindowStart) {
              longWindowValues.push(value)
            }
          }
        }

        if (shortWindowValues.length < 2 || longWindowValues.length < 2) {
          results.push({
            feature,
            correlation: 0,
            shortWindowMean: 0,
            longWindowMean: 0,
            shortWindowStd: 0,
            longWindowStd: 0,
            status: 'inconsistent',
            recommendation: 'Drop - insufficient data in time windows',
          })
          inconsistentCount++
          inconsistentFeatures.push(feature)
          continue
        }

        // Compute statistics
        const shortMean = mean(shortWindowValues)
        const longMean = mean(longWindowValues)
        const shortStd = std(shortWindowValues)
        const longStd = std(longWindowValues)

        // Compute correlation (using overlapping samples)
        const minLength = Math.min(
          shortWindowValues.length,
          longWindowValues.length,
        )
        const correlation = pearsonCorrelation(
          shortWindowValues.slice(0, minLength),
          longWindowValues.slice(0, minLength),
        )

        const status = getConsistencyStatus(correlation, threshold)
        const recommendation = getRecommendation(status)

        results.push({
          feature,
          correlation,
          shortWindowMean: shortMean,
          longWindowMean: longMean,
          shortWindowStd: shortStd,
          longWindowStd: longStd,
          status,
          recommendation,
        })

        totalCorrelation += Math.abs(correlation)

        if (status === 'inconsistent') {
          inconsistentCount++
          inconsistentFeatures.push(feature)
        } else {
          consistentCount++
        }
      }

      const result: Output = {
        temporalConsistency: results,
        summary: {
          totalFeatures: features.length,
          inconsistentCount,
          consistentCount,
          inconsistentFeatures,
          avgCorrelation:
            features.length > 0 ? totalCorrelation / features.length : 0,
        },
      }

      yield {
        type: 'result' as const,
        data: result,
        resultForAssistant: this.renderResultForAssistant(result),
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      const errorResult: Output = {
        temporalConsistency: [],
        summary: {
          totalFeatures: 0,
          inconsistentCount: 0,
          consistentCount: 0,
          inconsistentFeatures: [],
          avgCorrelation: 0,
        },
      }
      yield {
        type: 'result' as const,
        data: errorResult,
        resultForAssistant: `Temporal consistency computation failed: ${errorMessage}`,
      }
    }
  },
}
