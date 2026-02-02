import { z } from 'zod'
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import type { Tool, ValidationResult, ToolUseContext } from '@tool'
import { loadData, getNumericColumns, getCategoricalColumns } from '../../shared/dataLoader'
import { isValidValue } from '../../shared/validation'
import { mean, std } from '../../shared/statistics'
import { getGenerateCreditFeaturesPrompt } from './prompt'

export const inputSchema = z.strictObject({
  filePath: z.string().describe('Local CSV/Parquet file path'),
  outputPath: z.string().optional().describe('Output CSV path'),
  sampleSize: z.number().optional().default(10000),
  maxNumericPairs: z.number().optional().default(6),
  maxRatioFeatures: z.number().optional().default(20),
  maxInteractionFeatures: z.number().optional().default(20),
  topCategories: z.number().optional().default(5),
  includeOneHot: z.boolean().optional().default(false),
})

type Input = z.infer<typeof inputSchema>

type Output = {
  outputPath?: string
  features: {
    name: string
    type: 'numeric' | 'categorical'
    description: string
  }[]
  statistics: {
    rowsProcessed: number
    baseColumnCount: number
    numericColumnCount: number
    categoricalColumnCount: number
    generatedFeatureCount: number
  }
  preview: {
    featureNames: string[]
  }
}

export const GenerateCreditFeaturesTool: Tool<typeof inputSchema, Output> = {
  name: 'GenerateCreditFeatures',
  async description() {
    return 'Generate real feature variables from a local credit dataset (ratios, interactions, encodings)'
  },
  async prompt() {
    return getGenerateCreditFeaturesPrompt()
  },
  inputSchema,
  isReadOnly() {
    return false
  },
  isConcurrencySafe() {
    return false
  },
  userFacingName() {
    return 'GenerateCreditFeatures'
  },
  async isEnabled() {
    return true
  },
  needsPermissions() {
    return true
  },
  async validateInput(
    input: Input,
    _context?: ToolUseContext,
  ): Promise<ValidationResult> {
    if (!input.filePath) {
      return { result: false, message: 'filePath is required' }
    }
    return { result: true }
  },
  renderToolUseMessage(input: Input, { verbose }) {
    if (verbose) {
      return `GenerateCreditFeatures: ${input.filePath}`
    }
    return 'GenerateCreditFeatures'
  },
  renderResultForAssistant(output: Output): string {
    return [
      `Generated ${output.statistics.generatedFeatureCount} features from ${output.statistics.rowsProcessed} rows.`,
      output.outputPath ? `- Output file: ${output.outputPath}` : '',
    ]
      .filter(Boolean)
      .join('\n')
  },
  async *call(input: Input, { abortController }) {
    if (abortController.signal.aborted) {
      yield {
        type: 'result' as const,
        data: {
          features: [],
          statistics: {
            rowsProcessed: 0,
            baseColumnCount: 0,
            numericColumnCount: 0,
            categoricalColumnCount: 0,
            generatedFeatureCount: 0,
          },
          preview: { featureNames: [] },
        },
        resultForAssistant: 'Operation cancelled',
      }
      return
    }

    const df = await loadData({
      filePath: input.filePath,
      sampleSize: input.sampleSize,
    })

    const numericColumns = getNumericColumns(df)
    const categoricalColumns = getCategoricalColumns(df).filter(
      col => !numericColumns.includes(col),
    )

    const numericStats = new Map<
      string,
      { mean: number; std: number; values: number[] }
    >()
    for (const col of numericColumns) {
      const values = df.rows
        .map(row => toNumber(row[col]))
        .filter(value => value !== null) as number[]
      const columnMean = values.length > 0 ? mean(values) : 0
      const columnStd = values.length > 0 ? std(values) : 0
      numericStats.set(col, { mean: columnMean, std: columnStd, values })
    }

    const numericByVariance = [...numericColumns].sort((a, b) => {
      const statsA = numericStats.get(a)
      const statsB = numericStats.get(b)
      const varA = statsA ? statsA.std ** 2 : 0
      const varB = statsB ? statsB.std ** 2 : 0
      return varB - varA
    })

    const topNumeric = numericByVariance.slice(
      0,
      Math.max(1, input.maxNumericPairs || 6),
    )

    const ratioPairs = buildPairs(topNumeric, input.maxRatioFeatures || 20)
    const interactionPairs = buildPairs(
      topNumeric,
      input.maxInteractionFeatures || 20,
    )

    const categoryMaps = new Map<
      string,
      { freqMap: Map<string, number>; topValues: string[] }
    >()
    for (const col of categoricalColumns) {
      const counts = new Map<string, number>()
      for (const row of df.rows) {
        const value = row[col]
        const key = isValidValue(value) ? String(value) : '__missing__'
        counts.set(key, (counts.get(key) || 0) + 1)
      }
      const total = df.rows.length || 1
      const freqMap = new Map<string, number>()
      for (const [key, count] of counts.entries()) {
        freqMap.set(key, count / total)
      }
      const topValues = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, input.topCategories || 5)
        .map(entry => entry[0])
      categoryMaps.set(col, { freqMap, topValues })
    }

    const featureDefs: Output['features'] = []
    const outputRows = df.rows.map(row => {
      const outputRow: Record<string, unknown> = { ...row }

      for (const col of df.columns) {
        const featureName = `missing_${sanitizeToken(col)}`
        outputRow[featureName] = isValidValue(row[col]) ? 0 : 1
      }

      for (const col of numericColumns) {
        const value = toNumber(row[col])
        const stats = numericStats.get(col)
        const stdValue = stats?.std || 0
        const zscoreName = `zscore_${sanitizeToken(col)}`
        const logName = `log1p_${sanitizeToken(col)}`

        outputRow[zscoreName] =
          value === null || stdValue === 0 ? null : (value - (stats?.mean || 0)) / stdValue
        outputRow[logName] =
          value === null || value <= -1 ? null : Math.log1p(value)
      }

      for (const [left, right] of ratioPairs) {
        const numerator = toNumber(row[left])
        const denominator = toNumber(row[right])
        const name = `ratio_${sanitizeToken(left)}_to_${sanitizeToken(right)}`
        outputRow[name] =
          numerator === null || denominator === null || denominator === 0
            ? null
            : numerator / denominator
      }

      for (const [left, right] of interactionPairs) {
        const leftValue = toNumber(row[left])
        const rightValue = toNumber(row[right])
        const name = `interact_${sanitizeToken(left)}_x_${sanitizeToken(right)}`
        outputRow[name] =
          leftValue === null || rightValue === null ? null : leftValue * rightValue
      }

      for (const col of categoricalColumns) {
        const mapping = categoryMaps.get(col)
        if (!mapping) continue
        const value = row[col]
        const key = isValidValue(value) ? String(value) : '__missing__'
        const freqName = `freq_${sanitizeToken(col)}`
        outputRow[freqName] = mapping.freqMap.get(key) || 0

        if (input.includeOneHot) {
          for (const topValue of mapping.topValues) {
            const oneHotName = `onehot_${sanitizeToken(col)}_${sanitizeToken(topValue)}`
            outputRow[oneHotName] = key === topValue ? 1 : 0
          }
        }
      }

      return outputRow
    })

    featureDefs.push(
      ...df.columns.map(col => ({
        name: `missing_${sanitizeToken(col)}`,
        type: 'numeric' as const,
        description: `Missing indicator for ${col}`,
      })),
      ...numericColumns.map(col => ({
        name: `zscore_${sanitizeToken(col)}`,
        type: 'numeric' as const,
        description: `Z-score normalized ${col}`,
      })),
      ...numericColumns.map(col => ({
        name: `log1p_${sanitizeToken(col)}`,
        type: 'numeric' as const,
        description: `Log1p transform of ${col}`,
      })),
      ...ratioPairs.map(([left, right]) => ({
        name: `ratio_${sanitizeToken(left)}_to_${sanitizeToken(right)}`,
        type: 'numeric' as const,
        description: `Ratio of ${left} to ${right}`,
      })),
      ...interactionPairs.map(([left, right]) => ({
        name: `interact_${sanitizeToken(left)}_x_${sanitizeToken(right)}`,
        type: 'numeric' as const,
        description: `Interaction between ${left} and ${right}`,
      })),
      ...categoricalColumns.map(col => ({
        name: `freq_${sanitizeToken(col)}`,
        type: 'numeric' as const,
        description: `Frequency encoding for ${col}`,
      })),
    )

    if (input.includeOneHot) {
      for (const col of categoricalColumns) {
        const mapping = categoryMaps.get(col)
        if (!mapping) continue
        for (const topValue of mapping.topValues) {
          featureDefs.push({
            name: `onehot_${sanitizeToken(col)}_${sanitizeToken(topValue)}`,
            type: 'numeric' as const,
            description: `One-hot for ${col} = ${topValue}`,
          })
        }
      }
    }

    const outputPath = await writeOutputIfRequested(
      input.outputPath,
      input.filePath,
      outputRows,
    )

    const result: Output = {
      outputPath,
      features: featureDefs,
      statistics: {
        rowsProcessed: df.rowCount,
        baseColumnCount: df.columns.length,
        numericColumnCount: numericColumns.length,
        categoricalColumnCount: categoricalColumns.length,
        generatedFeatureCount: featureDefs.length,
      },
      preview: {
        featureNames: featureDefs.slice(0, 20).map(feature => feature.name),
      },
    }

    yield {
      type: 'result' as const,
      data: result,
      resultForAssistant: this.renderResultForAssistant(result),
    }
  },
}

function toNumber(value: unknown): number | null {
  if (!isValidValue(value)) return null
  if (typeof value === 'number' && !Number.isNaN(value)) return value
  const parsed = Number(value)
  return Number.isNaN(parsed) ? null : parsed
}

function sanitizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function buildPairs(
  columns: string[],
  maxPairs: number,
): [string, string][] {
  const pairs: [string, string][] = []
  for (let i = 0; i < columns.length; i += 1) {
    for (let j = 0; j < columns.length; j += 1) {
      if (i === j) continue
      pairs.push([columns[i], columns[j]])
      if (pairs.length >= maxPairs) return pairs
    }
  }
  return pairs
}

async function writeOutputIfRequested(
  outputPath: string | undefined,
  inputPath: string,
  rows: Record<string, unknown>[],
): Promise<string | undefined> {
  if (rows.length === 0) return outputPath
  const resolvedOutput =
    outputPath ||
    path.join(
      process.cwd(),
      'output',
      `credit_features_${Date.now()}.csv`,
    )

  await mkdir(path.dirname(resolvedOutput), { recursive: true })

  const columns = Object.keys(rows[0])
  const lines = [columns.join(',')]
  for (const row of rows) {
    const line = columns
      .map(col => formatCsvValue(row[col]))
      .join(',')
    lines.push(line)
  }

  await writeFile(resolvedOutput, lines.join('\n'), 'utf-8')
  return resolvedOutput
}

function formatCsvValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  const stringValue = String(value)
  if (stringValue.includes('"') || stringValue.includes(',') || stringValue.includes('\n')) {
    return `"${stringValue.replace(/"/g, '""')}"`
  }
  return stringValue
}
