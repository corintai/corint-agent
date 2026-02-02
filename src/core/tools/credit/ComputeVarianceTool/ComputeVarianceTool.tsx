import { z } from 'zod'
import type { Tool, ValidationResult, ToolUseContext } from '@tool'
import { getComputeVariancePrompt } from './prompt'
import type { VarianceResult } from './types'
import { validateDataSource, isValidValue } from '../shared/validation'
import { loadData, getColumnValues } from '../shared/dataLoader'
import { mean, variance, std } from '../shared/statistics'

export const inputSchema = z.strictObject({
  datasource: z.string().optional().describe('Name of the data source'),
  table: z.string().optional().describe('Table name (for SQL sources)'),
  filePath: z.string().optional().describe('File path (for local files)'),
  features: z.array(z.string()).describe('Feature column names (numeric only)'),
  threshold: z
    .number()
    .optional()
    .default(1e-6)
    .describe('Constant threshold (default: 1e-6)'),
})

type Input = z.infer<typeof inputSchema>
type Output = {
  variance: VarianceResult[]
  summary: {
    totalFeatures: number
    constantCount: number
    lowVarianceCount: number
    normalCount: number
    constantFeatures: string[]
    lowVarianceFeatures: string[]
  }
}

function parseNumeric(value: unknown): number | null {
  if (!isValidValue(value)) return null
  const parsed = typeof value === 'number' ? value : parseFloat(String(value))
  if (!Number.isFinite(parsed)) return null
  return parsed
}

function getVarianceStatus(
  variance: number,
  threshold: number,
): 'constant' | 'low_variance' | 'normal' {
  if (variance < threshold) return 'constant'
  if (variance < 0.01) return 'low_variance'
  return 'normal'
}

function getRecommendation(status: 'constant' | 'low_variance' | 'normal'): string {
  switch (status) {
    case 'constant':
      return 'Drop - no information content'
    case 'low_variance':
      return 'Review - very low variance, may not be useful'
    case 'normal':
      return 'Keep - normal variance'
  }
}

export const ComputeVarianceTool: Tool<typeof inputSchema, Output> = {
  name: 'ComputeVariance',
  async description() {
    return 'Calculate variance and standard deviation to detect low-variance features'
  },
  async prompt() {
    return getComputeVariancePrompt()
  },
  isReadOnly() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  inputSchema,
  userFacingName() {
    return 'ComputeVariance'
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
    const { datasource, table, filePath, features, threshold = 1e-6 } = input

    // Load data
    const data = await loadData({ datasource, table, filePath })

    const results: VarianceResult[] = []
    let constantCount = 0
    let lowVarianceCount = 0
    let normalCount = 0
    const constantFeatures: string[] = []
    const lowVarianceFeatures: string[] = []

    for (const feature of features) {
      const values = getColumnValues(data, feature)
      const numericValues = values.map(parseNumeric).filter((v): v is number => v !== null)

      if (numericValues.length === 0) {
        results.push({
          feature,
          variance: 0,
          std: 0,
          mean: 0,
          status: 'constant',
          recommendation: 'Drop - no valid numeric values',
        })
        constantCount++
        constantFeatures.push(feature)
        continue
      }

      const meanValue = mean(numericValues)
      const varianceValue = variance(numericValues)
      const stdValue = std(numericValues)
      const status = getVarianceStatus(varianceValue, threshold)
      const recommendation = getRecommendation(status)

      results.push({
        feature,
        variance: varianceValue,
        std: stdValue,
        mean: meanValue,
        status,
        recommendation,
      })

      if (status === 'constant') {
        constantCount++
        constantFeatures.push(feature)
      } else if (status === 'low_variance') {
        lowVarianceCount++
        lowVarianceFeatures.push(feature)
      } else {
        normalCount++
      }
    }

    return {
      variance: results,
      summary: {
        totalFeatures: features.length,
        constantCount,
        lowVarianceCount,
        normalCount,
        constantFeatures,
        lowVarianceFeatures,
      },
    }
  },
}
