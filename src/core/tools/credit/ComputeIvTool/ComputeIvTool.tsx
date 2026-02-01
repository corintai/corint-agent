import { z } from 'zod'
import type { Tool, ValidationResult, ToolUseContext } from '@tool'
import { getComputeIvPrompt } from './prompt'
import type { IvResult, WoeBin } from './types'
import {
  validateDataSource,
  validateBinCount,
  validateBinaryTarget,
  isValidValue,
} from '../shared/validation'
import { loadData, getColumnValues } from '../shared/dataLoader'
import { createBins } from '../shared/binning'
import { computeIV, interpretIV } from '../shared/statistics'

export const inputSchema = z.strictObject({
  datasource: z.string().optional().describe('Name of the data source'),
  table: z.string().optional().describe('Table name (for SQL sources)'),
  filePath: z.string().optional().describe('File path (for local files)'),
  features: z.array(z.string()).describe('Feature column names'),
  target: z.string().describe('Target variable (must be binary: 0/1)'),
  bins: z
    .number()
    .optional()
    .default(10)
    .describe('Number of bins (default: 10)'),
  method: z
    .enum(['quantile', 'equal_width', 'tree'])
    .optional()
    .default('quantile')
    .describe('Binning method (default: quantile)'),
})

type Input = z.infer<typeof inputSchema>
type Output = {
  iv: IvResult[]
  woe: {
    feature: string
    bins: WoeBin[]
  }[]
  summary: {
    totalFeatures: number
    strongFeatures: string[]
    weakFeatures: string[]
    suspiciousFeatures: string[]
    skippedFeatures: string[]
    skippedDetails: { feature: string; reason: 'missing' | 'no_valid_rows' | 'no_bins' }[]
  }
}

function parseNumeric(value: unknown): number | null {
  if (!isValidValue(value)) return null
  const parsed =
    typeof value === 'number' ? value : parseFloat(String(value))
  if (!Number.isFinite(parsed)) return null
  return parsed
}

export const ComputeIvTool: Tool<typeof inputSchema, Output> = {
  name: 'ComputeIv',
  async description() {
    return 'Calculate Information Value (IV) and Weight of Evidence (WOE) for feature selection'
  },
  async prompt() {
    return getComputeIvPrompt()
  },
  isReadOnly() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  inputSchema,
  userFacingName() {
    return 'ComputeIv'
  },
  async isEnabled() {
    return true
  },
  needsPermissions(): boolean {
    return true
  },
  async validateInput(
    { datasource, filePath, bins }: Input,
    _context?: ToolUseContext,
  ): Promise<ValidationResult> {
    const validation = validateDataSource(datasource, filePath)
    if (!validation.valid) {
      return { result: false, message: validation.error }
    }

    const binValidation = validateBinCount(bins)
    if (!binValidation.valid) {
      return { result: false, message: binValidation.error }
    }

    return { result: true }
  },

  renderToolUseMessage(
    { datasource, table, filePath, features, target }: Input,
    { verbose },
  ) {
    const source = datasource ? `${datasource}.${table}` : filePath
    if (verbose) {
      return `ComputeIv: ${source} (${features.length} features, target: ${target})`
    }
    return `ComputeIv: ${features.length} features`
  },

  renderResultForAssistant(output: Output): string {
    const lines = [
      `Information Value (IV) Analysis:`,
      `- Total features: ${output.summary.totalFeatures}`,
      `- Strong features: ${output.summary.strongFeatures.length}`,
      `- Weak features: ${output.summary.weakFeatures.length}`,
      `- Suspicious features: ${output.summary.suspiciousFeatures.length}`,
      `- Skipped features: ${output.summary.skippedFeatures.length}`,
      ``,
      `Feature Results:`,
    ]

    output.iv.forEach(result => {
      const powerIcon =
        result.predictivePower === 'strong'
          ? '✓'
          : result.predictivePower === 'suspicious'
            ? '⚠'
            : '○'
      lines.push(
        `  ${powerIcon} ${result.feature}: IV=${result.ivValue.toFixed(4)} (${result.predictivePower})`,
      )
      lines.push(`     ${result.recommendation}`)
    })

    if (output.summary.suspiciousFeatures.length > 0) {
      lines.push(``, `⚠️ Suspicious features detected (possible data leakage):`)
      output.summary.suspiciousFeatures.forEach(f => lines.push(`  - ${f}`))
    }

    if (output.summary.strongFeatures.length > 0) {
      lines.push(``, `✓ Recommended features for modeling:`)
      output.summary.strongFeatures.slice(0, 5).forEach(f => lines.push(`  - ${f}`))
    }

    if (output.summary.skippedFeatures.length > 0) {
      lines.push(``, `Skipped features (missing or non-numeric):`)
      const details =
        output.summary.skippedDetails.length > 0
          ? output.summary.skippedDetails
          : output.summary.skippedFeatures.map(feature => ({
              feature,
              reason: 'no_valid_rows' as const,
            }))

      details.slice(0, 5).forEach(detail => {
        lines.push(`  - ${detail.feature}: ${detail.reason}`)
      })
    }

    return lines.join('\n')
  },

  async *call(
    { datasource, table, filePath, features, target, bins, method }: Input,
    { abortController },
  ) {
    try {
      if (abortController.signal.aborted) {
        yield {
          type: 'result' as const,
          data: {
            iv: [],
            woe: [],
            summary: {
              totalFeatures: 0,
              strongFeatures: [],
              weakFeatures: [],
              suspiciousFeatures: [],
              skippedFeatures: [],
              skippedDetails: [],
            },
          },
          resultForAssistant: 'Operation cancelled',
        }
        return
      }

      const df = await loadData({ datasource, table, filePath })

      if (!df.columns.includes(target)) {
        throw new Error(`Target column "${target}" not found in dataset`)
      }

      const rawTargetValues = getColumnValues(df, target)
      const targetIndexValues: { index: number; value: number }[] = []
      let hasInvalidTargetValue = false

      rawTargetValues.forEach((value, index) => {
        const parsed = parseNumeric(value)
        if (parsed === null) {
          return
        }
        if (parsed !== 0 && parsed !== 1) {
          hasInvalidTargetValue = true
          return
        }
        targetIndexValues.push({ index, value: parsed })
      })

      if (hasInvalidTargetValue) {
        throw new Error('Target must contain only 0 and 1 values')
      }

      const targetValidation = validateBinaryTarget(
        targetIndexValues.map(item => item.value),
      )
      if (!targetValidation.valid) {
        throw new Error(targetValidation.error)
      }

      const ivResults: IvResult[] = []
      const woeResults: { feature: string; bins: WoeBin[] }[] = []
      const skippedFeatures: string[] = []
      const skippedDetails: {
        feature: string
        reason: 'missing' | 'no_valid_rows' | 'no_bins'
      }[] = []

      for (const featureName of features) {
        if (!df.columns.includes(featureName)) {
          skippedFeatures.push(featureName)
          skippedDetails.push({ feature: featureName, reason: 'missing' })
          continue
        }

        const rawFeatureValues = getColumnValues(df, featureName)
        const featureValues: number[] = []
        const alignedTargetValues: number[] = []

        targetIndexValues.forEach(({ index, value }) => {
          const parsed = parseNumeric(rawFeatureValues[index])
          if (parsed === null) {
            return
          }
          featureValues.push(parsed)
          alignedTargetValues.push(value)
        })

        if (featureValues.length === 0) {
          skippedFeatures.push(featureName)
          skippedDetails.push({ feature: featureName, reason: 'no_valid_rows' })
          continue
        }

        const binList = createBins(featureValues, { method, bins })
        if (binList.length === 0) {
          skippedFeatures.push(featureName)
          skippedDetails.push({ feature: featureName, reason: 'no_bins' })
          continue
        }
        const { iv, woeBins } = computeIV(
          featureValues,
          alignedTargetValues,
          binList,
        )
        const interpretation = interpretIV(iv)

        ivResults.push({
          feature: featureName,
          ivValue: iv,
          predictivePower: interpretation.predictivePower,
          recommendation: interpretation.recommendation,
        })

        woeResults.push({
          feature: featureName,
          bins: woeBins,
        })
      }

      const strongFeatures = ivResults
        .filter(r => r.predictivePower === 'strong' && r.ivValue < 0.5)
        .map(r => r.feature)

      const weakFeatures = ivResults
        .filter(r => r.predictivePower === 'weak')
        .map(r => r.feature)

      const suspiciousFeatures = ivResults
        .filter(r => r.predictivePower === 'suspicious')
        .map(r => r.feature)

      const result: Output = {
        iv: ivResults,
        woe: woeResults,
        summary: {
          totalFeatures: ivResults.length,
          strongFeatures,
          weakFeatures,
          suspiciousFeatures,
          skippedFeatures,
          skippedDetails,
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
        iv: [],
        woe: [],
        summary: {
          totalFeatures: 0,
          strongFeatures: [],
          weakFeatures: [],
          suspiciousFeatures: [],
          skippedFeatures: [],
          skippedDetails: [],
        },
      }

      yield {
        type: 'result' as const,
        data: errorResult,
        resultForAssistant: `IV computation failed: ${errorMessage}`,
      }
    }
  },
}
