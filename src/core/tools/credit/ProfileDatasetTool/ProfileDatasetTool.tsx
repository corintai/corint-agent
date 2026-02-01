import { z } from 'zod'
import type { Tool, ValidationResult, ToolUseContext } from '@tool'
import { getProfileDatasetPrompt } from './prompt'
import type { DatasetProfile, ColumnProfile } from './types'
import { validateDataSource, isValidValue } from '../shared/validation'
import { loadData, getColumnValues } from '../shared/dataLoader'
import { mean, median, std } from '../shared/statistics'

export const inputSchema = z.strictObject({
  datasource: z
    .string()
    .optional()
    .describe('Name of the data source (e.g., "credit_db")'),
  table: z.string().optional().describe('Table name (for SQL sources)'),
  filePath: z
    .string()
    .optional()
    .describe('File path (for local files: CSV, Parquet, Excel)'),
  sampleSize: z
    .number()
    .optional()
    .default(10000)
    .describe('Sample size for large datasets (default: 10000)'),
})

type Input = z.infer<typeof inputSchema>
type Output = DatasetProfile

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

function profileColumn(
  columnName: string,
  values: any[],
): ColumnProfile {
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
    }
  } else if (type === 'categorical') {
    const valueCounts = new Map<any, number>()
    validValues.forEach(v => {
      valueCounts.set(v, (valueCounts.get(v) || 0) + 1)
    })

    const topValues = Array.from(valueCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([value, count]) => ({
        value,
        count,
        percentage: count / validValues.length,
      }))

    profile.topValues = topValues
  }

  return profile
}

function estimateMemoryUsage(rowCount: number, columnCount: number): string {
  // Rough estimation: 100 bytes per cell
  const bytes = rowCount * columnCount * 100
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export const ProfileDatasetTool: Tool<typeof inputSchema, Output> = {
  name: 'ProfileDataset',
  async description() {
    return 'Generate comprehensive dataset profile with statistics and data quality metrics'
  },
  async prompt() {
    return getProfileDatasetPrompt()
  },
  isReadOnly() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  inputSchema,
  userFacingName() {
    return 'ProfileDataset'
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

  renderToolUseMessage({ datasource, table, filePath }: Input, { verbose }) {
    if (verbose) {
      return `ProfileDataset: ${datasource ? `${datasource}.${table}` : filePath}`
    }
    return `ProfileDataset: ${table || filePath}`
  },

  renderResultForAssistant(output: Output): string {
    const lines = [
      `Dataset Profile:`,
      `- Rows: ${output.rowCount}`,
      `- Columns: ${output.columnCount}`,
      `- Memory: ${output.memoryUsage}`,
      `- Sampling: ${output.samplingApplied ? 'Yes' : 'No'}`,
      ``,
      `Columns:`,
    ]

    output.columns.forEach(col => {
      lines.push(
        `  ${col.name} (${col.type}): ${col.uniqueCount} unique, ${(col.missingRate * 100).toFixed(1)}% missing`,
      )
      if (col.type === 'numeric' && col.mean !== undefined) {
        lines.push(
          `    Stats: min=${col.min?.toFixed(2)}, max=${col.max?.toFixed(2)}, mean=${col.mean.toFixed(2)}, median=${col.median?.toFixed(2)}`,
        )
      }
      if (col.type === 'categorical' && col.topValues) {
        const top3 = col.topValues
          .slice(0, 3)
          .map(v => `${v.value} (${(v.percentage * 100).toFixed(1)}%)`)
          .join(', ')
        lines.push(`    Top values: ${top3}`)
      }
    })

    return lines.join('\n')
  },

  async *call(
    { datasource, table, filePath, sampleSize }: Input,
    { abortController },
  ) {
    try {
      if (abortController.signal.aborted) {
        yield {
          type: 'result' as const,
          data: {
            rowCount: 0,
            columnCount: 0,
            columns: [],
            memoryUsage: '0 B',
            samplingApplied: false,
          },
          resultForAssistant: 'Operation cancelled',
        }
        return
      }

      const df = await loadData({ datasource, table, filePath, sampleSize })

      const columns: ColumnProfile[] = df.columns.map(colName => {
        const values = getColumnValues(df, colName)
        return profileColumn(colName, values)
      })

      const result: DatasetProfile = {
        rowCount: df.rowCount,
        columnCount: df.columns.length,
        columns,
        memoryUsage: estimateMemoryUsage(df.rowCount, df.columns.length),
        samplingApplied: sampleSize !== undefined && df.rowCount === sampleSize,
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
        rowCount: 0,
        columnCount: 0,
        columns: [],
        memoryUsage: '0 B',
        samplingApplied: false,
      }

      yield {
        type: 'result' as const,
        data: errorResult,
        resultForAssistant: `Profile failed: ${errorMessage}`,
      }
    }
  },
}
