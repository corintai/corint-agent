import { z } from 'zod'
import type { Tool, ValidationResult, ToolUseContext } from '@tool'
import { getComputePsiPrompt } from './prompt'
import type { PsiResult, PsiBinDetail } from './types'
import { validateDataSource, validateBinCount } from '../shared/validation'
import { loadData, getColumnValues } from '../shared/dataLoader'
import { createBins } from '../shared/binning'
import { computePSI, interpretPSI } from '../shared/statistics'

export const inputSchema = z.strictObject({
  baselineData: z
    .string()
    .describe('Baseline data source/file path (format: "datasource.table" or "/path/to/file")'),
  currentData: z
    .string()
    .describe('Current data source/file path'),
  columns: z.array(z.string()).describe('Columns to compute PSI'),
  bins: z
    .number()
    .optional()
    .default(10)
    .describe('Number of bins (default: 10)'),
  method: z
    .enum(['quantile', 'equal_width'])
    .optional()
    .default('quantile')
    .describe('Binning method (default: quantile)'),
})

type Input = z.infer<typeof inputSchema>
type Output = {
  psi: PsiResult[]
  details: {
    column: string
    bins: PsiBinDetail[]
  }[]
  summary: {
    totalColumns: number
    stableCount: number
    driftCount: number
    maxPsi: number
    maxPsiColumn: string
  }
}

function parseDataSource(dataStr: string): {
  datasource?: string
  table?: string
  filePath?: string
} {
  if (dataStr.includes('.') && !dataStr.includes('/')) {
    const [datasource, table] = dataStr.split('.')
    return { datasource, table }
  }
  return { filePath: dataStr }
}

export const ComputePsiTool: Tool<typeof inputSchema, Output> = {
  name: 'ComputePsi',
  async description() {
    return 'Calculate Population Stability Index (PSI) to detect distribution drift'
  },
  async prompt() {
    return getComputePsiPrompt()
  },
  isReadOnly() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  inputSchema,
  userFacingName() {
    return 'ComputePsi'
  },
  async isEnabled() {
    return true
  },
  needsPermissions(): boolean {
    return true
  },
  async validateInput(
    { baselineData, currentData, bins }: Input,
    _context?: ToolUseContext,
  ): Promise<ValidationResult> {
    const baselineParams = parseDataSource(baselineData)
    const currentParams = parseDataSource(currentData)

    const baselineValidation = validateDataSource(
      baselineParams.datasource,
      baselineParams.filePath,
    )
    if (!baselineValidation.valid) {
      return { result: false, message: `Baseline: ${baselineValidation.error}` }
    }

    const currentValidation = validateDataSource(
      currentParams.datasource,
      currentParams.filePath,
    )
    if (!currentValidation.valid) {
      return { result: false, message: `Current: ${currentValidation.error}` }
    }

    const binValidation = validateBinCount(bins)
    if (!binValidation.valid) {
      return { result: false, message: binValidation.error }
    }

    return { result: true }
  },

  renderToolUseMessage({ baselineData, currentData, columns }: Input, { verbose }) {
    if (verbose) {
      return `ComputePsi: ${baselineData} vs ${currentData} (${columns.length} columns)`
    }
    return `ComputePsi: ${columns.length} columns`
  },

  renderResultForAssistant(output: Output): string {
    const lines = [
      `PSI Analysis:`,
      `- Total columns: ${output.summary.totalColumns}`,
      `- Stable: ${output.summary.stableCount}`,
      `- Drift detected: ${output.summary.driftCount}`,
      `- Max PSI: ${output.summary.maxPsi.toFixed(4)} (${output.summary.maxPsiColumn})`,
      ``,
      `Column Results:`,
    ]

    output.psi.forEach(result => {
      const statusIcon =
        result.status === 'stable' ? '✓' : result.status === 'warning' ? '⚠' : '✗'
      lines.push(
        `  ${statusIcon} ${result.column}: PSI=${result.psiValue.toFixed(4)} (${result.status})`,
      )
      lines.push(`     ${result.interpretation}`)
    })

    if (output.summary.driftCount > 0) {
      lines.push(``, `⚠️ Drift detected in ${output.summary.driftCount} column(s)`)
      lines.push(`Recommendation: Investigate data changes or retrain model`)
    }

    return lines.join('\n')
  },

  async *call(
    { baselineData, currentData, columns, bins, method }: Input,
    { abortController },
  ) {
    try {
      if (abortController.signal.aborted) {
        yield {
          type: 'result' as const,
          data: {
            psi: [],
            details: [],
            summary: {
              totalColumns: 0,
              stableCount: 0,
              driftCount: 0,
              maxPsi: 0,
              maxPsiColumn: '',
            },
          },
          resultForAssistant: 'Operation cancelled',
        }
        return
      }

      const baselineParams = parseDataSource(baselineData)
      const currentParams = parseDataSource(currentData)

      const baselineDf = await loadData(baselineParams)
      const currentDf = await loadData(currentParams)

      const psiResults: PsiResult[] = []
      const details: { column: string; bins: PsiBinDetail[] }[] = []

      for (const colName of columns) {
        if (
          !baselineDf.columns.includes(colName) ||
          !currentDf.columns.includes(colName)
        ) {
          continue
        }

        const baselineValues = getColumnValues(baselineDf, colName).filter(
          v => typeof v === 'number' && !isNaN(v),
        ) as number[]
        const currentValues = getColumnValues(currentDf, colName).filter(
          v => typeof v === 'number' && !isNaN(v),
        ) as number[]

        if (baselineValues.length === 0 || currentValues.length === 0) {
          continue
        }

        const binList = createBins(baselineValues, { method, bins })
        const psiValue = computePSI(baselineValues, currentValues, binList)
        const interpretation = interpretPSI(psiValue)

        psiResults.push({
          column: colName,
          psiValue,
          status: interpretation.status,
          interpretation: interpretation.interpretation,
        })

        const binDetails: PsiBinDetail[] = binList.map(bin => {
          const baselineCount = baselineValues.filter(
            v => v > bin.min && v <= bin.max,
          ).length
          const currentCount = currentValues.filter(
            v => v > bin.min && v <= bin.max,
          ).length

          const baselinePct = baselineCount / baselineValues.length
          const currentPct = currentCount / currentValues.length

          const epsilon = 0.0001
          const adjustedBaselinePct = Math.max(baselinePct, epsilon)
          const adjustedCurrentPct = Math.max(currentPct, epsilon)

          const contribution =
            (adjustedCurrentPct - adjustedBaselinePct) *
            Math.log(adjustedCurrentPct / adjustedBaselinePct)

          return {
            range: bin.range,
            baselinePct,
            currentPct,
            contribution,
          }
        })

        details.push({
          column: colName,
          bins: binDetails,
        })
      }

      const stableCount = psiResults.filter(r => r.status === 'stable').length
      const driftCount = psiResults.filter(r => r.status === 'drift').length
      const maxPsiResult = psiResults.reduce(
        (max, r) => (r.psiValue > max.psiValue ? r : max),
        psiResults[0],
      )

      const result: Output = {
        psi: psiResults,
        details,
        summary: {
          totalColumns: psiResults.length,
          stableCount,
          driftCount,
          maxPsi: maxPsiResult?.psiValue || 0,
          maxPsiColumn: maxPsiResult?.column || '',
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
        psi: [],
        details: [],
        summary: {
          totalColumns: 0,
          stableCount: 0,
          driftCount: 0,
          maxPsi: 0,
          maxPsiColumn: '',
        },
      }

      yield {
        type: 'result' as const,
        data: errorResult,
        resultForAssistant: `PSI computation failed: ${errorMessage}`,
      }
    }
  },
}
