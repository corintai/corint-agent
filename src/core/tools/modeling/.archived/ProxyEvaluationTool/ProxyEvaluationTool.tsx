import { z } from 'zod'
import type { Tool, ValidationResult, ToolUseContext } from '@tool'
import { loadPrimitives } from '../shared/primitives'
import type { FeatureCandidate } from '../shared/types'
import { validateDataSource, isValidValue } from '../../shared/validation'
import { loadData, getColumnValues } from '../../shared/dataLoader'
import { mean, std } from '../../shared/statistics'
import { getProxyEvaluationPrompt } from './prompt'

const windowSchema = z.strictObject({
  value: z.number(),
  unit: z.enum(['s', 'm', 'h', 'd', 'w', 'mo', 'y']),
  label: z.string(),
  seconds: z.number(),
  group: z.string().optional(),
  groupType: z.string().optional(),
})

const candidateSchema = z.strictObject({
  name: z.string(),
  subjectId: z.string(),
  subjectPrefix: z.string(),
  metric: z.string(),
  object: z.string(),
  event: z.string().optional(),
  dimension: z.string().optional(),
  window: windowSchema,
  family: z.string(),
})

export const inputSchema = z.strictObject({
  primitivesPath: z.string().optional(),
  datasource: z.string().optional(),
  table: z.string().optional(),
  filePath: z.string().optional(),
  candidates: z
    .array(z.union([candidateSchema, z.string()]))
    .describe('Feature candidates or feature names to evaluate'),
  samplingStrategy: z
    .strictObject({
      method: z.enum(['random', 'recent', 'active']).default('random'),
      sampleRate: z.number().min(0.01).max(0.5).default(0.05),
    })
    .optional(),
  thresholds: z
    .strictObject({
      max_missing_rate: z.number().optional(),
      min_variance: z.number().optional(),
      min_entropy: z.number().optional(),
      max_quantile_collapse: z.number().optional(),
      min_temporal_consistency: z.number().optional(),
    })
    .optional(),
})

type Input = z.infer<typeof inputSchema>

type ProxyMetrics = {
  missing_rate: number
  variance: number
  entropy: number
  quantile_collapse: number
  temporal_consistency: number
}

type Output = {
  passed: {
    candidate: FeatureCandidate | { name: string }
    proxyMetrics: ProxyMetrics
    proxyScore: number
  }[]
  rejected: {
    candidate: FeatureCandidate | { name: string }
    reason: string
  }[]
  statistics: {
    computeCost: number
  }
}

export const ProxyEvaluationTool: Tool<typeof inputSchema, Output> = {
  name: 'ProxyEvaluation',
  async description() {
    return 'Evaluate feature candidates on a sample dataset to prune low-quality features'
  },
  async prompt() {
    return getProxyEvaluationPrompt()
  },
  isReadOnly() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  inputSchema,
  userFacingName() {
    return 'ProxyEvaluation'
  },
  async isEnabled() {
    return true
  },
  needsPermissions() {
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
  renderToolUseMessage(_input: Input, { verbose }) {
    if (verbose) {
      return 'ProxyEvaluation: compute proxy metrics on sample data'
    }
    return 'ProxyEvaluation'
  },
  renderResultForAssistant(output: Output): string {
    return [
      `Proxy evaluation completed.`,
      `- Passed: ${output.passed.length}`,
      `- Rejected: ${output.rejected.length}`,
      `- Compute cost: ${(output.statistics.computeCost * 100).toFixed(1)}% of full data`,
    ].join('\n')
  },
  async *call(input: Input, { abortController }) {
    if (abortController.signal.aborted) {
      yield {
        type: 'result' as const,
        data: { passed: [], rejected: [], statistics: { computeCost: 0 } },
        resultForAssistant: 'Operation cancelled',
      }
      return
    }

    const { primitives } = await loadPrimitives(input.primitivesPath)
    const defaults = primitives.constraints?.proxy_thresholds || {}
    const thresholds = {
      max_missing_rate: input.thresholds?.max_missing_rate ?? defaults.max_missing_rate ?? 0.8,
      min_variance: input.thresholds?.min_variance ?? defaults.min_variance ?? 1e-6,
      min_entropy: input.thresholds?.min_entropy ?? defaults.min_entropy ?? 1.0,
      max_quantile_collapse:
        input.thresholds?.max_quantile_collapse ?? defaults.max_quantile_collapse ?? 0.9,
      min_temporal_consistency:
        input.thresholds?.min_temporal_consistency ?? defaults.min_temporal_consistency ?? 0.3,
    }

    const sampling = input.samplingStrategy || { method: 'random', sampleRate: 0.05 }
    const df = await loadData({
      datasource: input.datasource,
      table: input.table,
      filePath: input.filePath,
      sampleSize: 10000,
    })

    const sampleSize = Math.max(1, Math.floor(df.rowCount * sampling.sampleRate))
    const sampledRows = sampleRows(df.rows, sampleSize, sampling.method)
    const sampledDf = {
      columns: df.columns,
      rows: sampledRows,
      rowCount: sampledRows.length,
    }

    const passed: Output['passed'] = []
    const rejected: Output['rejected'] = []

    for (const candidate of input.candidates as Array<FeatureCandidate | string>) {
      const name = typeof candidate === 'string' ? candidate : candidate.name
      if (!sampledDf.columns.includes(name)) {
        rejected.push({
          candidate: typeof candidate === 'string' ? { name } : candidate,
          reason: 'feature column not found in dataset',
        })
        continue
      }

      const values = getColumnValues(sampledDf, name)
      const metrics = computeProxyMetrics(values)

      const reason = checkProxyThresholds(metrics, thresholds)
      const proxyScore = computeProxyScore(metrics)

      if (reason) {
        rejected.push({
          candidate: typeof candidate === 'string' ? { name } : candidate,
          reason,
        })
      } else {
        passed.push({
          candidate: typeof candidate === 'string' ? { name } : candidate,
          proxyMetrics: metrics,
          proxyScore,
        })
      }
    }

    const result: Output = {
      passed,
      rejected,
      statistics: {
        computeCost: sampling.sampleRate,
      },
    }

    yield {
      type: 'result' as const,
      data: result,
      resultForAssistant: this.renderResultForAssistant(result),
    }
  },
}

function sampleRows<T>(
  rows: T[],
  sampleSize: number,
  method: 'random' | 'recent' | 'active',
): T[] {
  if (rows.length <= sampleSize) return rows
  if (method === 'recent') {
    return rows.slice(-sampleSize)
  }
  if (method === 'random') {
    const shuffled = [...rows]
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    return shuffled.slice(0, sampleSize)
  }
  return rows.slice(0, sampleSize)
}

function computeProxyMetrics(values: any[]): ProxyMetrics {
  const totalCount = values.length
  const validValues = values.filter(v => isValidValue(v))
  const missingRate = totalCount > 0 ? 1 - validValues.length / totalCount : 0

  const numericValues = validValues
    .map(v => (typeof v === 'number' ? v : Number(v)))
    .filter(v => !Number.isNaN(v))

  const variance =
    numericValues.length > 1 ? Math.pow(std(numericValues), 2) : 0

  const entropy = computeEntropy(validValues)
  const quantileCollapse = computeQuantileCollapse(numericValues, validValues)
  const temporalConsistency = computeTemporalConsistency(numericValues, validValues)

  return {
    missing_rate: missingRate,
    variance,
    entropy,
    quantile_collapse: quantileCollapse,
    temporal_consistency: temporalConsistency,
  }
}

function computeEntropy(values: any[]): number {
  if (values.length === 0) return 0
  const counts = new Map<string, number>()
  values.forEach(v => {
    const key = String(v)
    counts.set(key, (counts.get(key) || 0) + 1)
  })
  let entropy = 0
  const total = values.length
  for (const count of counts.values()) {
    const p = count / total
    entropy -= p * Math.log2(p)
  }
  return entropy
}

function computeQuantileCollapse(
  numericValues: number[],
  values: any[],
): number {
  if (numericValues.length > 0) {
    const sorted = [...numericValues].sort((a, b) => a - b)
    const bins = 10
    const counts = Array.from({ length: bins }, () => 0)
    for (const value of sorted) {
      const idx = Math.min(
        bins - 1,
        Math.floor((value - sorted[0]) / (sorted[sorted.length - 1] - sorted[0] + 1e-9) * bins),
      )
      counts[idx] += 1
    }
    const nonZero = counts.filter(c => c > 0).length
    return 1 - nonZero / bins
  }

  const uniqueCount = new Set(values.map(v => String(v))).size
  if (values.length === 0) return 1
  return 1 - Math.min(uniqueCount, 10) / 10
}

function computeTemporalConsistency(
  numericValues: number[],
  values: any[],
): number {
  if (values.length < 2) return 0
  const mid = Math.floor(values.length / 2)
  if (numericValues.length > 0) {
    const first = numericValues.slice(0, Math.floor(numericValues.length / 2))
    const second = numericValues.slice(Math.floor(numericValues.length / 2))
    const mean1 = mean(first)
    const mean2 = mean(second)
    return 1 - Math.abs(mean1 - mean2) / (Math.abs(mean1) + Math.abs(mean2) + 1e-9)
  }
  const firstSet = new Set(values.slice(0, mid).map(v => String(v)))
  const secondSet = new Set(values.slice(mid).map(v => String(v)))
  const intersection = new Set(
    [...firstSet].filter(value => secondSet.has(value)),
  )
  const union = new Set([...firstSet, ...secondSet])
  return union.size > 0 ? intersection.size / union.size : 0
}

function checkProxyThresholds(
  metrics: ProxyMetrics,
  thresholds: {
    max_missing_rate: number
    min_variance: number
    min_entropy: number
    max_quantile_collapse: number
    min_temporal_consistency: number
  },
): string | null {
  if (metrics.missing_rate > thresholds.max_missing_rate) {
    return 'missing rate exceeds threshold'
  }
  if (metrics.variance < thresholds.min_variance) {
    return 'variance below threshold'
  }
  if (metrics.entropy < thresholds.min_entropy) {
    return 'entropy below threshold'
  }
  if (metrics.quantile_collapse > thresholds.max_quantile_collapse) {
    return 'quantile collapse exceeds threshold'
  }
  if (metrics.temporal_consistency < thresholds.min_temporal_consistency) {
    return 'temporal consistency below threshold'
  }
  return null
}

function computeProxyScore(metrics: ProxyMetrics): number {
  const entropyScore = metrics.entropy === 0 ? 0 : Math.min(metrics.entropy / 5, 1)
  const varianceScore = metrics.variance > 0 ? 1 : 0
  return (
    0.3 * (1 - metrics.missing_rate) +
    0.2 * varianceScore +
    0.2 * entropyScore +
    0.2 * (1 - metrics.quantile_collapse) +
    0.1 * metrics.temporal_consistency
  )
}
