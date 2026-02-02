import { z } from 'zod'
import type { Tool, ValidationResult, ToolUseContext } from '@tool'
import { getEvaluateFeaturesPrompt } from './prompt'
import type { EvaluationMetric, EvaluateFeaturesOutput } from './types'
import type { IvResult, WoeBin, CoverageResult } from '../shared/types'
import {
  validateDataSource,
  validateBinCount,
  validateBinaryTarget,
  isValidValue,
} from '../shared/validation'
import { loadData, getColumnValues } from '../shared/dataLoader'
import { createBins } from '../shared/binning'
import { computeIV, interpretIV, computePSI, interpretPSI } from '../shared/statistics'

export const inputSchema = z.strictObject({
  datasource: z.string().optional().describe('Name of the data source'),
  table: z.string().optional().describe('Table name (for SQL sources)'),
  filePath: z.string().optional().describe('File path (for local files)'),
  baselineFilePath: z
    .string()
    .optional()
    .describe('Baseline file path (for PSI calculation)'),
  features: z.array(z.string()).describe('Feature column names'),
  target: z.string().describe('Target variable (must be binary: 0/1)'),
  metrics: z
    .array(z.enum(['iv', 'psi', 'coverage']))
    .describe('Evaluation metrics to compute'),
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

function parseNumeric(value: unknown): number | null {
  if (!isValidValue(value)) return null
  const parsed = typeof value === 'number' ? value : parseFloat(String(value))
  if (!Number.isFinite(parsed)) return null
  return parsed
}

export const EvaluateFeaturesTool: Tool<typeof inputSchema, EvaluateFeaturesOutput> = {
  name: 'EvaluateFeatures',
  async description() {
    return 'Evaluate feature predictive power and stability (IV, PSI, Coverage)'
  },
  async prompt() {
    return getEvaluateFeaturesPrompt()
  },
  isReadOnly() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  inputSchema,
  userFacingName() {
    return 'EvaluateFeatures'
  },
  async isEnabled() {
    return true
  },
  needsPermissions(): boolean {
    return true
  },
  async validateInput(
    { datasource, filePath, bins, metrics, baselineFilePath }: Input,
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

    if (metrics.includes('psi') && !baselineFilePath) {
      return {
        result: false,
        message: 'baselineFilePath is required for PSI calculation',
      }
    }

    return { result: true }
  },

  renderToolUseMessage(
    { datasource, table, filePath, features, target, metrics }: Input,
    { verbose },
  ) {
    const source = datasource ? `${datasource}.${table}` : filePath
    if (verbose) {
      return `EvaluateFeatures: ${source} (${features.length} features, target: ${target}, metrics: ${metrics.join(', ')})`
    }
    return `EvaluateFeatures: ${metrics.join(', ')}`
  },

  renderResultForAssistant(output: EvaluateFeaturesOutput): string {
    const lines: string[] = ['Feature Evaluation Results:', '']

    if (output.iv) {
      lines.push('## Information Value (IV) Analysis')
      lines.push(`- Total features: ${output.iv.summary.totalFeatures}`)
      lines.push(`- Strong features: ${output.iv.summary.strongFeatures.length}`)
      lines.push(`- Weak features: ${output.iv.summary.weakFeatures.length}`)
      lines.push(
        `- Suspicious features: ${output.iv.summary.suspiciousFeatures.length}`,
      )
      lines.push('')

      lines.push('Feature Results:')
      output.iv.results.forEach(result => {
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

      if (output.iv.summary.suspiciousFeatures.length > 0) {
        lines.push('')
        lines.push('⚠️ Suspicious features detected (possible data leakage):')
        output.iv.summary.suspiciousFeatures.forEach(f => lines.push(`  - ${f}`))
      }

      if (output.iv.summary.strongFeatures.length > 0) {
        lines.push('')
        lines.push('✓ Recommended features for modeling:')
        output.iv.summary.strongFeatures.slice(0, 5).forEach(f => lines.push(`  - ${f}`))
      }
      lines.push('')
    }

    if (output.psi) {
      lines.push('## Population Stability Index (PSI) Analysis')
      lines.push(`- Total features: ${output.psi.summary.totalFeatures}`)
      lines.push(`- Stable features: ${output.psi.summary.stableFeatures.length}`)
      lines.push(`- Warning features: ${output.psi.summary.warningFeatures.length}`)
      lines.push(`- Drift features: ${output.psi.summary.driftFeatures.length}`)
      lines.push('')

      output.psi.results.forEach(result => {
        const icon =
          result.status === 'stable' ? '✓' : result.status === 'warning' ? '○' : '⚠'
        lines.push(
          `  ${icon} ${result.column}: PSI=${result.psiValue.toFixed(4)} (${result.status})`,
        )
        lines.push(`     ${result.interpretation}`)
      })
      lines.push('')
    }

    if (output.coverage) {
      lines.push('## Coverage Analysis')
      lines.push(`- Total features: ${output.coverage.summary.totalFeatures}`)
      lines.push(`- Good coverage: ${output.coverage.summary.goodFeatures.length}`)
      lines.push(
        `- Warning coverage: ${output.coverage.summary.warningFeatures.length}`,
      )
      lines.push(`- Poor coverage: ${output.coverage.summary.poorFeatures.length}`)
      lines.push('')

      output.coverage.results.forEach(result => {
        const icon =
          result.status === 'good' ? '✓' : result.status === 'warning' ? '○' : '⚠'
        lines.push(
          `  ${icon} ${result.feature}: ${(result.coverageRate * 100).toFixed(1)}% (${result.validCount}/${result.totalCount})`,
        )
        lines.push(`     ${result.recommendation}`)
      })
      lines.push('')
    }

    return lines.join('\n')
  },

  async *call(
    {
      datasource,
      table,
      filePath,
      baselineFilePath,
      features,
      target,
      metrics,
      bins,
      method,
    }: Input,
    { abortController },
  ) {
    try {
      if (abortController.signal.aborted) {
        yield {
          type: 'result' as const,
          data: {},
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
        if (parsed === null) return
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

      const result: EvaluateFeaturesOutput = {}

      // Compute IV
      if (metrics.includes('iv')) {
        const ivResults: IvResult[] = []
        const woeResults: { feature: string; bins: WoeBin[] }[] = []
        const skippedFeatures: string[] = []

        for (const featureName of features) {
          if (!df.columns.includes(featureName)) {
            skippedFeatures.push(featureName)
            continue
          }

          const rawFeatureValues = getColumnValues(df, featureName)
          const featureValues: number[] = []
          const alignedTargetValues: number[] = []

          targetIndexValues.forEach(({ index, value }) => {
            const parsed = parseNumeric(rawFeatureValues[index])
            if (parsed === null) return
            featureValues.push(parsed)
            alignedTargetValues.push(value)
          })

          if (featureValues.length === 0) {
            skippedFeatures.push(featureName)
            continue
          }

          const binList = createBins(featureValues, { method, bins })
          if (binList.length === 0) {
            skippedFeatures.push(featureName)
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

        result.iv = {
          results: ivResults,
          woe: woeResults,
          summary: {
            totalFeatures: ivResults.length,
            strongFeatures,
            weakFeatures,
            suspiciousFeatures,
            skippedFeatures,
          },
        }
      }

      // Compute Coverage
      if (metrics.includes('coverage')) {
        const coverageResults: CoverageResult[] = []

        for (const featureName of features) {
          if (!df.columns.includes(featureName)) continue

          const values = getColumnValues(df, featureName)
          const totalCount = values.length
          const validCount = values.filter(v => isValidValue(v)).length
          const coverageRate = validCount / totalCount

          let status: 'good' | 'warning' | 'poor'
          let recommendation: string

          if (coverageRate >= 0.9) {
            status = 'good'
            recommendation = 'Good coverage, safe to use'
          } else if (coverageRate >= 0.7) {
            status = 'warning'
            recommendation = 'Moderate coverage, consider imputation'
          } else {
            status = 'poor'
            recommendation = 'Poor coverage, consider removing or careful imputation'
          }

          coverageResults.push({
            feature: featureName,
            coverageRate,
            validCount,
            totalCount,
            status,
            recommendation,
          })
        }

        const goodFeatures = coverageResults
          .filter(r => r.status === 'good')
          .map(r => r.feature)
        const warningFeatures = coverageResults
          .filter(r => r.status === 'warning')
          .map(r => r.feature)
        const poorFeatures = coverageResults
          .filter(r => r.status === 'poor')
          .map(r => r.feature)

        result.coverage = {
          results: coverageResults,
          summary: {
            totalFeatures: coverageResults.length,
            goodFeatures,
            warningFeatures,
            poorFeatures,
          },
        }
      }

      // TODO: Implement PSI calculation
      if (metrics.includes('psi')) {
        // Requires baseline data loading and comparison
      }

      yield {
        type: 'result' as const,
        data: result,
        resultForAssistant: this.renderResultForAssistant(result),
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      yield {
        type: 'result' as const,
        data: {},
        resultForAssistant: `Feature evaluation failed: ${errorMessage}`,
      }
    }
  },
}
