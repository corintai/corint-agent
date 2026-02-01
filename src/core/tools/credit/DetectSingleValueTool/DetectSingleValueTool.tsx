import { z } from 'zod'
import type { Tool, ValidationResult, ToolUseContext } from '@tool'
import { getDetectSingleValuePrompt } from './prompt'
import type { SingleValueResult } from './types'
import { validateDataSource, isValidValue } from '../shared/validation'
import { loadData, getColumnValues } from '../shared/dataLoader'

export const inputSchema = z.strictObject({
  datasource: z.string().optional().describe('Name of the data source'),
  table: z.string().optional().describe('Table name (for SQL sources)'),
  filePath: z.string().optional().describe('File path (for local files)'),
  features: z
    .array(z.string())
    .optional()
    .describe('Specific features (default: all columns)'),
  threshold: z
    .number()
    .optional()
    .default(0.95)
    .describe('Dominant value threshold (default: 0.95)'),
})

type Input = z.infer<typeof inputSchema>
type Output = {
  singleValueFeatures: SingleValueResult[]
  summary: {
    totalChecked: number
    singleValueCount: number
    recommendDrop: string[]
    recommendReview: string[]
  }
}

function detectSingleValue(
  values: any[],
  threshold: number,
): {
  isSingleValue: boolean
  dominantValue: any
  dominantRate: number
  uniqueCount: number
} {
  const validValues = values.filter(v => isValidValue(v))
  if (validValues.length === 0) {
    return {
      isSingleValue: false,
      dominantValue: null,
      dominantRate: 0,
      uniqueCount: 0,
    }
  }

  const valueCounts = new Map<any, number>()
  validValues.forEach(v => {
    valueCounts.set(v, (valueCounts.get(v) || 0) + 1)
  })

  const sortedCounts = Array.from(valueCounts.entries()).sort(
    (a, b) => b[1] - a[1],
  )

  const [dominantValue, dominantCount] = sortedCounts[0]
  const dominantRate = dominantCount / validValues.length
  const uniqueCount = valueCounts.size

  return {
    isSingleValue: dominantRate >= threshold,
    dominantValue,
    dominantRate,
    uniqueCount,
  }
}

function getRecommendation(
  dominantRate: number,
): 'drop' | 'review' {
  if (dominantRate >= 0.99) return 'drop'
  return 'review'
}

function getReason(dominantRate: number, uniqueCount: number): string {
  if (dominantRate >= 0.99) {
    return `${(dominantRate * 100).toFixed(1)}% of values are identical, no variance`
  }
  return `${(dominantRate * 100).toFixed(1)}% dominated by single value, only ${uniqueCount} unique values`
}

export const DetectSingleValueTool: Tool<typeof inputSchema, Output> = {
  name: 'DetectSingleValue',
  async description() {
    return 'Detect features with single dominant value (low variance)'
  },
  async prompt() {
    return getDetectSingleValuePrompt()
  },
  isReadOnly() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  inputSchema,
  userFacingName() {
    return 'DetectSingleValue'
  },
  async isEnabled() {
    return true
  },
  needsPermissions(): boolean {
    return true
  },
  async validateInput(
    { datasource, filePath, threshold }: Input,
    _context?: ToolUseContext,
  ): Promise<ValidationResult> {
    const validation = validateDataSource(datasource, filePath)
    if (!validation.valid) {
      return { result: false, message: validation.error }
    }

    if (threshold < 0 || threshold > 1) {
      return {
        result: false,
        message: 'Threshold must be between 0 and 1',
      }
    }

    return { result: true }
  },

  renderToolUseMessage(
    { datasource, table, filePath, features, threshold }: Input,
    { verbose },
  ) {
    const source = datasource ? `${datasource}.${table}` : filePath
    if (verbose) {
      return `DetectSingleValue: ${source} (${features?.length || 'all'} features, threshold: ${threshold})`
    }
    return `DetectSingleValue: ${table || filePath}`
  },

  renderResultForAssistant(output: Output): string {
    const lines = [
      `Single Value Detection:`,
      `- Total checked: ${output.summary.totalChecked}`,
      `- Single value features: ${output.summary.singleValueCount}`,
      `- Recommend drop: ${output.summary.recommendDrop.length}`,
      `- Recommend review: ${output.summary.recommendReview.length}`,
      ``,
    ]

    if (output.singleValueFeatures.length === 0) {
      lines.push(`✓ No single-value features detected`)
    } else {
      lines.push(`Single Value Features:`)
      output.singleValueFeatures.forEach(result => {
        const icon = result.recommendation === 'drop' ? '✗' : '⚠'
        lines.push(
          `  ${icon} ${result.feature}: ${(result.dominantRate * 100).toFixed(1)}% = ${JSON.stringify(result.dominantValue)}`,
        )
        lines.push(`     ${result.reason}`)
        lines.push(`     Recommendation: ${result.recommendation}`)
      })
    }

    if (output.summary.recommendDrop.length > 0) {
      lines.push(``, `✗ Recommend dropping these features:`)
      output.summary.recommendDrop.forEach(f => lines.push(`  - ${f}`))
    }

    return lines.join('\n')
  },

  async *call(
    { datasource, table, filePath, features, threshold }: Input,
    { abortController },
  ) {
    try {
      if (abortController.signal.aborted) {
        yield {
          type: 'result' as const,
          data: {
            singleValueFeatures: [],
            summary: {
              totalChecked: 0,
              singleValueCount: 0,
              recommendDrop: [],
              recommendReview: [],
            },
          },
          resultForAssistant: 'Operation cancelled',
        }
        return
      }

      const df = await loadData({ datasource, table, filePath })

      const featuresToCheck = features || df.columns
      const singleValueFeatures: SingleValueResult[] = []

      for (const featureName of featuresToCheck) {
        if (!df.columns.includes(featureName)) {
          continue
        }

        const values = getColumnValues(df, featureName)
        const detection = detectSingleValue(values, threshold)

        if (detection.isSingleValue) {
          const recommendation = getRecommendation(detection.dominantRate)
          const reason = getReason(detection.dominantRate, detection.uniqueCount)

          singleValueFeatures.push({
            feature: featureName,
            dominantValue: detection.dominantValue,
            dominantRate: detection.dominantRate,
            uniqueCount: detection.uniqueCount,
            recommendation,
            reason,
          })
        }
      }

      const recommendDrop = singleValueFeatures
        .filter(r => r.recommendation === 'drop')
        .map(r => r.feature)

      const recommendReview = singleValueFeatures
        .filter(r => r.recommendation === 'review')
        .map(r => r.feature)

      const result: Output = {
        singleValueFeatures,
        summary: {
          totalChecked: featuresToCheck.length,
          singleValueCount: singleValueFeatures.length,
          recommendDrop,
          recommendReview,
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
        singleValueFeatures: [],
        summary: {
          totalChecked: 0,
          singleValueCount: 0,
          recommendDrop: [],
          recommendReview: [],
        },
      }

      yield {
        type: 'result' as const,
        data: errorResult,
        resultForAssistant: `Single value detection failed: ${errorMessage}`,
      }
    }
  },
}
