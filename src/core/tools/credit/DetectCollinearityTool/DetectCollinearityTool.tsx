import { z } from 'zod'
import type { Tool, ValidationResult, ToolUseContext } from '@tool'
import { getDetectCollinearityPrompt } from './prompt'
import type { CollinearityPair } from './types'
import { validateDataSource, isValidValue } from '../shared/validation'
import { loadData, getColumnValues } from '../shared/dataLoader'
import { mean } from '../shared/statistics'

export const inputSchema = z.strictObject({
  datasource: z.string().optional().describe('Name of the data source'),
  table: z.string().optional().describe('Table name (for SQL sources)'),
  filePath: z.string().optional().describe('File path (for local files)'),
  features: z.array(z.string()).describe('Feature column names (numeric only)'),
  threshold: z
    .number()
    .optional()
    .default(0.8)
    .describe('Correlation threshold (default: 0.8)'),
  method: z
    .enum(['correlation'])
    .optional()
    .default('correlation')
    .describe('Detection method (default: correlation)'),
})

type Input = z.infer<typeof inputSchema>
type Output = {
  collinearPairs: CollinearityPair[]
  summary: {
    totalPairs: number
    highCollinearCount: number
    recommendedKeep: string[]
    recommendedRemoval: string[]
  }
}

function parseNumeric(value: unknown): number | null {
  if (!isValidValue(value)) return null
  const parsed = typeof value === 'number' ? value : parseFloat(String(value))
  if (!Number.isFinite(parsed)) return null
  return parsed
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

function getRecommendation(
  feature1: string,
  feature2: string,
  correlation: number,
): { recommendation: 'keep_feature1' | 'keep_feature2' | 'review'; reason: string } {
  // Simple heuristic: prefer shorter names (often more fundamental features)
  if (feature1.length < feature2.length) {
    return {
      recommendation: 'keep_feature1',
      reason: `Keep ${feature1} (shorter name, likely more fundamental)`,
    }
  } else if (feature2.length < feature1.length) {
    return {
      recommendation: 'keep_feature2',
      reason: `Keep ${feature2} (shorter name, likely more fundamental)`,
    }
  } else {
    return {
      recommendation: 'review',
      reason: 'Manual review recommended - similar feature complexity',
    }
  }
}

export const DetectCollinearityTool: Tool<typeof inputSchema, Output> = {
  name: 'DetectCollinearity',
  async description() {
    return 'Detect highly correlated feature pairs to reduce redundancy'
  },
  async prompt() {
    return getDetectCollinearityPrompt()
  },
  isReadOnly() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  inputSchema,
  userFacingName() {
    return 'DetectCollinearity'
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
    const { datasource, table, filePath, features, threshold = 0.8 } = input

    // Load data
    const data = await loadData({ datasource, table, filePath })

    // Parse all features
    const featureData: Map<string, number[]> = new Map()

    for (const feature of features) {
      const values = getColumnValues(data, feature)
      const numericValues = values.map(parseNumeric).filter((v): v is number => v !== null)

      if (numericValues.length > 0) {
        featureData.set(feature, numericValues)
      }
    }

    // Compute pairwise correlations
    const collinearPairs: CollinearityPair[] = []
    const featureList = Array.from(featureData.keys())
    const toRemove = new Set<string>()

    for (let i = 0; i < featureList.length; i++) {
      for (let j = i + 1; j < featureList.length; j++) {
        const feature1 = featureList[i]
        const feature2 = featureList[j]

        const values1 = featureData.get(feature1)!
        const values2 = featureData.get(feature2)!

        // Align lengths
        const minLength = Math.min(values1.length, values2.length)
        const correlation = pearsonCorrelation(
          values1.slice(0, minLength),
          values2.slice(0, minLength),
        )

        if (Math.abs(correlation) >= threshold) {
          const { recommendation, reason } = getRecommendation(feature1, feature2, correlation)

          collinearPairs.push({
            feature1,
            feature2,
            correlation,
            recommendation,
            reason,
          })

          // Track features to remove
          if (recommendation === 'keep_feature1') {
            toRemove.add(feature2)
          } else if (recommendation === 'keep_feature2') {
            toRemove.add(feature1)
          }
        }
      }
    }

    const recommendedKeep = featureList.filter(f => !toRemove.has(f))
    const recommendedRemoval = Array.from(toRemove)

    return {
      collinearPairs,
      summary: {
        totalPairs: collinearPairs.length,
        highCollinearCount: collinearPairs.length,
        recommendedKeep,
        recommendedRemoval,
      },
    }
  },
}
