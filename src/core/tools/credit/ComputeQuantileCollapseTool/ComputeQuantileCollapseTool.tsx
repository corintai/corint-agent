import { z } from 'zod'
import type { Tool, ValidationResult, ToolUseContext } from '@tool'
import { getComputeQuantileCollapsePrompt } from './prompt'
import type { QuantileCollapseResult } from './types'
import { validateDataSource, isValidValue } from '../shared/validation'
import { loadData, getColumnValues } from '../shared/dataLoader'

export const inputSchema = z.strictObject({
  datasource: z.string().optional().describe('Name of the data source'),
  table: z.string().optional().describe('Table name (for SQL sources)'),
  filePath: z.string().optional().describe('File path (for local files)'),
  features: z.array(z.string()).describe('Feature column names (numeric only)'),
  threshold: z
    .number()
    .optional()
    .default(0.1)
    .describe('Collapse threshold (default: 0.1)'),
})

type Input = z.infer<typeof inputSchema>
type Output = {
  quantileCollapse: QuantileCollapseResult[]
  summary: {
    totalFeatures: number
    collapsedCount: number
    normalCount: number
    collapsedFeatures: string[]
    avgCollapseRate: number
  }
}

function parseNumeric(value: unknown): number | null {
  if (!isValidValue(value)) return null
  const parsed = typeof value === 'number' ? value : parseFloat(String(value))
  if (!Number.isFinite(parsed)) return null
  return parsed
}

function quantile(sortedValues: number[], q: number): number {
  const pos = (sortedValues.length - 1) * q
  const base = Math.floor(pos)
  const rest = pos - base
  if (sortedValues[base + 1] !== undefined) {
    return sortedValues[base] + rest * (sortedValues[base + 1] - sortedValues[base])
  }
  return sortedValues[base]
}

function getCollapseStatus(
  collapseRate: number,
  threshold: number,
): 'collapsed' | 'normal' {
  return collapseRate < threshold ? 'collapsed' : 'normal'
}

function getRecommendation(status: 'collapsed' | 'normal'): string {
  return status === 'collapsed'
    ? 'Review - values highly concentrated, low information spread'
    : 'Keep - normal distribution spread'
}

export const ComputeQuantileCollapseTool: Tool<typeof inputSchema, Output> = {
  name: 'ComputeQuantileCollapse',
  async description() {
    return 'Calculate quantile collapse rate to detect concentrated distributions'
  },
  async prompt() {
    return getComputeQuantileCollapsePrompt()
  },
  isReadOnly() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  inputSchema,
  userFacingName() {
    return 'ComputeQuantileCollapse'
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
    const { datasource, table, filePath, features, threshold = 0.1 } = input

    // Load data
    const data = await loadData({ datasource, table, filePath })

    const results: QuantileCollapseResult[] = []
    let collapsedCount = 0
    let normalCount = 0
    const collapsedFeatures: string[] = []
    let totalCollapseRate = 0

    for (const feature of features) {
      const values = getColumnValues(data, feature)
      const numericValues = values
        .map(parseNumeric)
        .filter((v): v is number => v !== null)
        .sort((a, b) => a - b)

      if (numericValues.length === 0) {
        results.push({
          feature,
          collapseRate: 0,
          iqr: 0,
          range: 0,
          q25: 0,
          q75: 0,
          min: 0,
          max: 0,
          status: 'collapsed',
          recommendation: 'Drop - no valid numeric values',
        })
        collapsedCount++
        collapsedFeatures.push(feature)
        continue
      }

      const min = numericValues[0]
      const max = numericValues[numericValues.length - 1]
      const q25 = quantile(numericValues, 0.25)
      const q75 = quantile(numericValues, 0.75)
      const iqr = q75 - q25
      const range = max - min

      // Avoid division by zero
      const collapseRate = range > 0 ? iqr / range : 0

      const status = getCollapseStatus(collapseRate, threshold)
      const recommendation = getRecommendation(status)

      results.push({
        feature,
        collapseRate,
        iqr,
        range,
        q25,
        q75,
        min,
        max,
        status,
        recommendation,
      })

      totalCollapseRate += collapseRate

      if (status === 'collapsed') {
        collapsedCount++
        collapsedFeatures.push(feature)
      } else {
        normalCount++
      }
    }

    return {
      quantileCollapse: results,
      summary: {
        totalFeatures: features.length,
        collapsedCount,
        normalCount,
        collapsedFeatures,
        avgCollapseRate: features.length > 0 ? totalCollapseRate / features.length : 0,
      },
    }
  },
}
