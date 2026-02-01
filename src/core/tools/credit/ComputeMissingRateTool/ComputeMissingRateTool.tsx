import { z } from 'zod'
import type { Tool, ValidationResult, ToolUseContext } from '@tool'
import { getComputeMissingRatePrompt } from './prompt'
import type { MissingRateResult } from './types'
import { validateDataSource, isValidValue } from '../shared/validation'
import { loadData, getColumnValues } from '../shared/dataLoader'

export const inputSchema = z.strictObject({
  datasource: z.string().optional().describe('Name of the data source'),
  table: z.string().optional().describe('Table name (for SQL sources)'),
  filePath: z.string().optional().describe('File path (for local files)'),
  columns: z
    .array(z.string())
    .optional()
    .describe('Specific columns to analyze (default: all)'),
  groupBy: z
    .string()
    .optional()
    .describe('Group by field (e.g., date, region)'),
})

type Input = z.infer<typeof inputSchema>
type Output = {
  overall: MissingRateResult[]
  byGroup?: { group: string; missingRates: Record<string, number> }[]
  summary: {
    avgMissingRate: number
    highMissingColumns: string[]
  }
}

function computeMissingRate(values: any[]): {
  missingRate: number
  missingCount: number
  totalCount: number
} {
  const totalCount = values.length
  const validCount = values.filter(v => isValidValue(v)).length
  const missingCount = totalCount - validCount
  const missingRate = totalCount > 0 ? missingCount / totalCount : 0

  return { missingRate, missingCount, totalCount }
}

function getMissingStatus(
  missingRate: number,
): 'good' | 'warning' | 'critical' {
  if (missingRate < 0.05) return 'good'
  if (missingRate < 0.3) return 'warning'
  return 'critical'
}

export const ComputeMissingRateTool: Tool<typeof inputSchema, Output> = {
  name: 'ComputeMissingRate',
  async description() {
    return 'Calculate missing value rates for dataset columns with optional grouping'
  },
  async prompt() {
    return getComputeMissingRatePrompt()
  },
  isReadOnly() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  inputSchema,
  userFacingName() {
    return 'ComputeMissingRate'
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
    { datasource, table, filePath, columns }: Input,
    { verbose },
  ) {
    const source = datasource ? `${datasource}.${table}` : filePath
    if (verbose) {
      return `ComputeMissingRate: ${source} (${columns?.length || 'all'} columns)`
    }
    return `ComputeMissingRate: ${table || filePath}`
  },

  renderResultForAssistant(output: Output): string {
    const lines = [
      `Missing Rate Analysis:`,
      `- Average missing rate: ${(output.summary.avgMissingRate * 100).toFixed(2)}%`,
      `- High missing columns: ${output.summary.highMissingColumns.length}`,
      ``,
      `Column Details:`,
    ]

    output.overall.forEach(result => {
      const statusIcon =
        result.status === 'good' ? '✓' : result.status === 'warning' ? '⚠' : '✗'
      lines.push(
        `  ${statusIcon} ${result.column}: ${(result.missingRate * 100).toFixed(2)}% (${result.missingCount}/${result.totalCount})`,
      )
    })

    if (output.byGroup && output.byGroup.length > 0) {
      lines.push(``, `By Group:`)
      output.byGroup.slice(0, 5).forEach(group => {
        lines.push(`  ${group.group}:`)
        Object.entries(group.missingRates)
          .slice(0, 3)
          .forEach(([col, rate]) => {
            lines.push(`    ${col}: ${(rate * 100).toFixed(2)}%`)
          })
      })
    }

    return lines.join('\n')
  },

  async *call(
    { datasource, table, filePath, columns, groupBy }: Input,
    { abortController },
  ) {
    try {
      if (abortController.signal.aborted) {
        yield {
          type: 'result' as const,
          data: { overall: [], summary: { avgMissingRate: 0, highMissingColumns: [] } },
          resultForAssistant: 'Operation cancelled',
        }
        return
      }

      const df = await loadData({ datasource, table, filePath })

      const columnsToAnalyze = columns || df.columns
      const overall: MissingRateResult[] = []

      for (const colName of columnsToAnalyze) {
        if (!df.columns.includes(colName)) {
          continue
        }

        const values = getColumnValues(df, colName)
        const { missingRate, missingCount, totalCount } =
          computeMissingRate(values)

        overall.push({
          column: colName,
          missingRate,
          missingCount,
          totalCount,
          status: getMissingStatus(missingRate),
        })
      }

      let byGroup: { group: string; missingRates: Record<string, number> }[] | undefined

      if (groupBy && df.columns.includes(groupBy)) {
        const groupValues = getColumnValues(df, groupBy)
        const uniqueGroups = [...new Set(groupValues)]

        byGroup = uniqueGroups.map(group => {
          const groupIndices = groupValues
            .map((v, i) => (v === group ? i : -1))
            .filter(i => i !== -1)

          const missingRates: Record<string, number> = {}

          for (const colName of columnsToAnalyze) {
            const values = getColumnValues(df, colName)
            const groupColumnValues = groupIndices.map(i => values[i])
            const { missingRate } = computeMissingRate(groupColumnValues)
            missingRates[colName] = missingRate
          }

          return {
            group: String(group),
            missingRates,
          }
        })
      }

      const avgMissingRate =
        overall.reduce((sum, r) => sum + r.missingRate, 0) / overall.length
      const highMissingColumns = overall
        .filter(r => r.missingRate > 0.5)
        .map(r => r.column)

      const result: Output = {
        overall,
        byGroup,
        summary: {
          avgMissingRate,
          highMissingColumns,
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
        overall: [],
        summary: { avgMissingRate: 0, highMissingColumns: [] },
      }

      yield {
        type: 'result' as const,
        data: errorResult,
        resultForAssistant: `Missing rate computation failed: ${errorMessage}`,
      }
    }
  },
}
