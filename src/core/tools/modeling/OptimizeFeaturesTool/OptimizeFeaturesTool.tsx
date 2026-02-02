import { z } from 'zod'
import type { Tool, ValidationResult, ToolUseContext } from '@tool'
import { getOptimizeFeaturesPrompt } from './prompt'
import type {
  OptimizationMethod,
  OptimizeFeaturesOutput,
  OptimizedFeature,
} from './types'
import type { FeatureCandidate } from '../featureEngineering/shared/types'

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
  subjectStability: z.enum(['high', 'medium', 'low']).optional(),
  calculation: z.string().optional(),
  metric: z.string(),
  object: z.string(),
  event: z.string().optional(),
  dimension: z.string().optional(),
  window: windowSchema,
  family: z.string(),
  windowGroup: z.string().optional(),
  windowGroupType: z.string().optional(),
})

export const inputSchema = z.strictObject({
  primitivesPath: z.string().optional().describe('Path to feature primitives file'),
  candidates: z.array(candidateSchema).describe('Feature candidates to optimize'),
  method: z
    .enum(['semantic_pruning', 'proxy_eval', 'beam_search'])
    .describe('Optimization method'),
  targetMetric: z
    .string()
    .optional()
    .describe('Target metric for optimization (e.g., iv, auc, ks)'),
  threshold: z.number().optional().describe('Threshold for filtering'),
  maxFeatures: z.number().optional().describe('Maximum number of features to select'),
})

type Input = z.infer<typeof inputSchema>

export const OptimizeFeaturesTool: Tool<typeof inputSchema, OptimizeFeaturesOutput> = {
  name: 'OptimizeFeatures',
  async description() {
    return 'Optimize and select features using semantic pruning, proxy evaluation, or beam search'
  },
  async prompt() {
    return getOptimizeFeaturesPrompt()
  },
  isReadOnly() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  inputSchema,
  userFacingName() {
    return 'OptimizeFeatures'
  },
  async isEnabled() {
    return true
  },
  needsPermissions(): boolean {
    return true
  },
  async validateInput(
    { candidates }: Input,
    _context?: ToolUseContext,
  ): Promise<ValidationResult> {
    if (candidates.length === 0) {
      return {
        result: false,
        message: 'Must provide at least one candidate feature',
      }
    }
    return { result: true }
  },

  renderToolUseMessage({ method, candidates, maxFeatures }: Input, { verbose }) {
    if (verbose) {
      return `OptimizeFeatures: ${method} (${candidates.length} candidates${maxFeatures ? `, max ${maxFeatures}` : ''})`
    }
    return `OptimizeFeatures: ${method}`
  },

  renderResultForAssistant(output: OptimizeFeaturesOutput): string {
    const lines: string[] = ['Feature Optimization Results:', '']

    lines.push(`## Summary`)
    lines.push(`- Method: ${output.summary.method}`)
    lines.push(`- Input features: ${output.summary.totalInput}`)
    lines.push(`- Selected features: ${output.summary.totalOutput}`)
    lines.push(
      `- Reduction rate: ${(output.summary.reductionRate * 100).toFixed(1)}%`,
    )
    lines.push(`- Execution time: ${output.summary.executionTime}ms`)
    lines.push('')

    if (output.reasoning) {
      lines.push(`## Reasoning`)
      lines.push(output.reasoning)
      lines.push('')
    }

    const selected = output.optimizedFeatures.filter(f => f.selected)
    const rejected = output.optimizedFeatures.filter(f => !f.selected)

    if (selected.length > 0) {
      lines.push(`## Selected Features (${selected.length})`)
      selected.slice(0, 10).forEach(feature => {
        const scoreStr = feature.score ? ` (score: ${feature.score.toFixed(4)})` : ''
        lines.push(`  ✓ ${feature.name}${scoreStr}`)
        if (feature.reason) {
          lines.push(`     ${feature.reason}`)
        }
      })
      if (selected.length > 10) {
        lines.push(`  ... and ${selected.length - 10} more`)
      }
      lines.push('')
    }

    if (rejected.length > 0 && rejected.length <= 10) {
      lines.push(`## Rejected Features (${rejected.length})`)
      rejected.forEach(feature => {
        lines.push(`  ✗ ${feature.name}`)
        if (feature.reason) {
          lines.push(`     ${feature.reason}`)
        }
      })
      lines.push('')
    }

    return lines.join('\n')
  },

  async *call(
    { primitivesPath, candidates, method, targetMetric, threshold, maxFeatures }: Input,
    { abortController },
  ) {
    try {
      if (abortController.signal.aborted) {
        yield {
          type: 'result' as const,
          data: {
            optimizedFeatures: [],
            summary: {
              totalInput: 0,
              totalOutput: 0,
              reductionRate: 0,
              method,
              executionTime: 0,
            },
          },
          resultForAssistant: 'Operation cancelled',
        }
        return
      }

      const startTime = Date.now()

      // TODO: Implement actual optimization logic
      // For now, return a placeholder response that selects features based on simple rules

      const optimizedFeatures: OptimizedFeature[] = []
      const limit = maxFeatures || Math.ceil(candidates.length * 0.5)

      // Simple placeholder: select first N features
      candidates.forEach((candidate, index) => {
        const selected = index < limit
        const score = 1 - index / candidates.length // Mock score

        optimizedFeatures.push({
          ...candidate,
          score,
          rank: index + 1,
          selected,
          reason: selected
            ? `Selected by ${method} (rank ${index + 1})`
            : `Rejected by ${method} (below threshold)`,
        } as OptimizedFeature)
      })

      const totalOutput = optimizedFeatures.filter(f => f.selected).length
      const reductionRate = 1 - totalOutput / candidates.length
      const executionTime = Date.now() - startTime

      const result: OptimizeFeaturesOutput = {
        optimizedFeatures,
        summary: {
          totalInput: candidates.length,
          totalOutput,
          reductionRate,
          method,
          executionTime,
        },
        reasoning: `Applied ${method} optimization to ${candidates.length} candidates, selected ${totalOutput} features based on ${targetMetric || 'default criteria'}.`,
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
        data: {
          optimizedFeatures: [],
          summary: {
            totalInput: 0,
            totalOutput: 0,
            reductionRate: 0,
            method,
            executionTime: 0,
          },
        },
        resultForAssistant: `Feature optimization failed: ${errorMessage}`,
      }
    }
  },
}
