import { z } from 'zod'
import type { Tool, ValidationResult, ToolUseContext } from '@tool'
import { getComputeCoveragePrompt } from './prompt'
import type { CoverageResult } from './types'
import { validateDataSource, isValidValue } from '../shared/validation'
import { loadData, getColumnValues } from '../shared/dataLoader'

export const inputSchema = z.strictObject({
  datasource: z.string().optional().describe('Name of the data source'),
  table: z.string().optional().describe('Table name (for SQL sources)'),
  filePath: z.string().optional().describe('File path (for local files)'),
  features: z.array(z.string()).describe('Feature column names'),
  threshold: z
    .number()
    .optional()
    .default(0.0)
    .describe('Non-null threshold (default: 0.0)'),
})

type Input = z.infer<typeof inputSchema>
type Output = {
  coverage: CoverageResult[]
  summary: {
    avgCoverage: number
    lowCoverageFeatures: string[]
    goodCoverageCount: number
    poorCoverageCount: number
  }
}

function computeCoverage(values: any[]): {
  coverageRate: number
  validCount: number
  totalCount: number
} {
  const totalCount = values.length
  const validCount = values.filter(v => isValidValue(v)).length
  const coverageRate = totalCount > 0 ? validCount / totalCount : 0

  return { coverageRate, validCount, totalCount }
}

function getCoverageStatus(
  coverageRate: number,
): 'good' | 'warning' | 'poor' {
  if (coverageRate >= 0.9) return 'good'
  if (coverageRate >= 0.7) return 'warning'
  return 'poor'
}

function getCoverageRecommendation(
  coverageRate: number,
  status: 'good' | 'warning' | 'poor',
): string {
  if (status === 'good') return 'Good coverage, suitable for modeling'
  if (status === 'warning')
    return 'Moderate coverage, consider imputation or removal'
  return 'Poor coverage, recommend removal or investigate data source'
}

export const ComputeCoverageTool: Tool<typeof inputSchema, Output> = {
  name: 'ComputeCoverage',
  async description() {
    return 'Calculate feature coverage rate (non-null, non-empty values)'
  },
  async prompt() {
    return getComputeCoveragePrompt()
  },
  isReadOnly() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  inputSchema,
  userFacingName() {
    return 'ComputeCoverage'
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
    { datasource, table, filePath, features }: Input,
    { verbose },
  ) {
    const source = datasource ? `${datasource}.${table}` : filePath
    if (verbose) {
      return `ComputeCoverage: ${source} (${features.length} features)`
    }
    return `ComputeCoverage: ${features.length} features`
  },

  renderResultForAssistant(output: Output): string {
    const lines = [
      `Coverage Analysis:`,
      `- Average coverage: ${(output.summary.avgCoverage * 100).toFixed(2)}%`,
      `- Good coverage: ${output.summary.goodCoverageCount} features`,
      `- Poor coverage: ${output.summary.poorCoverageCount} features`,
      ``,
      `Feature Details:`,
    ]

    output.coverage.forEach(result => {
      const statusIcon =
        result.status === 'good' ? '✓' : result.status === 'warning' ? '⚠' : '✗'
      lines.push(
        `  ${statusIcon} ${result.feature}: ${(result.coverageRate * 100).toFixed(2)}% (${result.validCount}/${result.totalCount})`,
      )
      if (result.status !== 'good') {
        lines.push(`     ${result.recommendation}`)
      }
    })

    if (output.summary.lowCoverageFeatures.length > 0) {
      lines.push(``, `⚠️ Low coverage features (<70%):`)
      output.summary.lowCoverageFeatures.forEach(f => lines.push(`  - ${f}`))
    }

    return lines.join('\n')
  },

  async *call(
    { datasource, table, filePath, features }: Input,
    { abortController },
  ) {
    try {
      if (abortController.signal.aborted) {
        yield {
          type: 'result' as const,
          data: {
            coverage: [],
            summary: {
              avgCoverage: 0,
              lowCoverageFeatures: [],
              goodCoverageCount: 0,
              poorCoverageCount: 0,
            },
          },
          resultForAssistant: 'Operation cancelled',
        }
        return
      }

      const df = await loadData({ datasource, table, filePath })

      const coverageResults: CoverageResult[] = []

      for (const featureName of features) {
        if (!df.columns.includes(featureName)) {
          continue
        }

        const values = getColumnValues(df, featureName)
        const { coverageRate, validCount, totalCount } = computeCoverage(values)
        const status = getCoverageStatus(coverageRate)

        coverageResults.push({
          feature: featureName,
          coverageRate,
          validCount,
          totalCount,
          status,
          recommendation: getCoverageRecommendation(coverageRate, status),
        })
      }

      const avgCoverage =
        coverageResults.reduce((sum, r) => sum + r.coverageRate, 0) /
        coverageResults.length

      const lowCoverageFeatures = coverageResults
        .filter(r => r.coverageRate < 0.7)
        .map(r => r.feature)

      const goodCoverageCount = coverageResults.filter(
        r => r.status === 'good',
      ).length
      const poorCoverageCount = coverageResults.filter(
        r => r.status === 'poor',
      ).length

      const result: Output = {
        coverage: coverageResults,
        summary: {
          avgCoverage,
          lowCoverageFeatures,
          goodCoverageCount,
          poorCoverageCount,
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
        coverage: [],
        summary: {
          avgCoverage: 0,
          lowCoverageFeatures: [],
          goodCoverageCount: 0,
          poorCoverageCount: 0,
        },
      }

      yield {
        type: 'result' as const,
        data: errorResult,
        resultForAssistant: `Coverage computation failed: ${errorMessage}`,
      }
    }
  },
}
