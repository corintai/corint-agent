import { z } from 'zod'
import type { Tool, ValidationResult, ToolUseContext } from '@tool'
import { loadPrimitives, parseWindowLimit } from '../shared/primitives'
import { generateCandidates } from '../shared/candidates'
import { validateCandidateAgainstPrimitives } from '../shared/candidateValidation'
import { evaluateBusinessRule } from '../shared/businessRules'
import type { FeatureCandidate, FeaturePrimitives } from '../shared/types'
import { getSemanticPruningPrompt } from './prompt'

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

const generationSchema = z.strictObject({
  subjects: z.array(z.string()).optional(),
  metrics: z.array(z.string()).optional(),
  families: z.array(z.string()).optional(),
  objects: z.array(z.string()).optional(),
  events: z.array(z.string()).optional(),
  dimensions: z.array(z.string()).optional(),
  windows: z.array(z.string()).optional(),
  includeCalculationMethods: z.array(z.string()).optional(),
})

export const inputSchema = z.strictObject({
  primitivesPath: z
    .string()
    .optional()
    .describe('Path to feature_primitives.yaml'),
  candidates: z
    .array(candidateSchema)
    .optional()
    .describe('Candidate features to prune'),
  generation: generationSchema
    .optional()
    .describe('Candidate generation options when candidates omitted'),
  pruningRules: z
    .strictObject({
      hardConstraints: z.boolean().optional().default(true),
      businessRules: z.boolean().optional().default(true),
    })
    .optional(),
})

type Input = z.infer<typeof inputSchema>

type Output = {
  passed: FeatureCandidate[]
  pruned: { candidate: FeatureCandidate; reason: string }[]
  statistics: {
    totalInput: number
    totalPassed: number
    pruneRate: number
  }
}

export const SemanticPruningTool: Tool<typeof inputSchema, Output> = {
  name: 'SemanticPruning',
  async description() {
    return 'Prune feature candidates using hard constraints and business rules without data scans'
  },
  async prompt() {
    return getSemanticPruningPrompt()
  },
  isReadOnly() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  inputSchema,
  userFacingName() {
    return 'SemanticPruning'
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
    if (!input.candidates && !input.generation) {
      return {
        result: false,
        message: 'Provide candidates or generation options for pruning',
      }
    }
    return { result: true }
  },
  renderToolUseMessage(_input: Input, { verbose }) {
    if (verbose) {
      return 'SemanticPruning: apply Gate 1 rules'
    }
    return 'SemanticPruning'
  },
  renderResultForAssistant(output: Output): string {
    return [
      `Semantic pruning completed.`,
      `- Input candidates: ${output.statistics.totalInput}`,
      `- Passed: ${output.statistics.totalPassed}`,
      `- Prune rate: ${(output.statistics.pruneRate * 100).toFixed(1)}%`,
    ].join('\n')
  },
  async *call(input: Input, { abortController }) {
    if (abortController.signal.aborted) {
      yield {
        type: 'result' as const,
        data: { passed: [], pruned: [], statistics: { totalInput: 0, totalPassed: 0, pruneRate: 0 } },
        resultForAssistant: 'Operation cancelled',
      }
      return
    }

    const { primitives, subjectsById, aggregationsById } = await loadPrimitives(
      input.primitivesPath,
    )

    const candidates =
      (input.candidates as FeatureCandidate[] | undefined) ||
      generateCandidates(primitives, {
        subjects: input.generation?.subjects,
        metrics: input.generation?.metrics,
        families: input.generation?.families as any,
        objects: input.generation?.objects,
        events: input.generation?.events,
        dimensions: input.generation?.dimensions,
        windows: input.generation?.windows,
        includeCalculationMethods: input.generation?.includeCalculationMethods,
      })

    const hardConstraints = input.pruningRules?.hardConstraints ?? true
    const businessRules = input.pruningRules?.businessRules ?? true

    const passed: FeatureCandidate[] = []
    const pruned: { candidate: FeatureCandidate; reason: string }[] = []

    for (const candidate of candidates) {
      const validation = validateCandidateAgainstPrimitives(candidate, primitives)
      if (!validation.valid) {
        pruned.push({
          candidate,
          reason: validation.reason || 'invalid candidate',
        })
        continue
      }

      const subject = subjectsById[candidate.subjectId]
      let reason: string | null = null

      if (hardConstraints && subject) {
        reason = checkHardConstraints(candidate, subject, primitives, aggregationsById)
      }

      if (!reason && businessRules && primitives.constraints?.business_rules) {
        const matchedRule = primitives.constraints.business_rules.find(rule =>
          evaluateBusinessRule(rule.condition, candidate, primitives),
        )
        if (matchedRule) {
          reason = matchedRule.reason
        }
      }

      if (reason) {
        pruned.push({ candidate, reason })
      } else {
        passed.push(candidate)
      }
    }

    const totalInput = candidates.length
    const totalPassed = passed.length
    const pruneRate = totalInput > 0 ? 1 - totalPassed / totalInput : 0

    const result: Output = {
      passed,
      pruned,
      statistics: {
        totalInput,
        totalPassed,
        pruneRate,
      },
    }

    yield {
      type: 'result' as const,
      data: result,
      resultForAssistant: this.renderResultForAssistant(result),
    }
  },
}

function checkHardConstraints(
  candidate: FeatureCandidate,
  subject: FeaturePrimitives['subjects'][0],
  primitives: FeaturePrimitives,
  aggregationsById: Record<string, { min_window?: string; incompatible_metrics?: string[] }>,
): string | null {
  const maxWindowSeconds = parseWindowLimit(subject.max_window)
  if (maxWindowSeconds && candidate.window.seconds > maxWindowSeconds) {
    return `window exceeds max for subject ${subject.id}`
  }

  if (subject.allow_realtime === false && candidate.window.seconds < 3600) {
    return `subject ${subject.id} does not allow realtime windows`
  }

  if (candidate.family === 'lifecycle' && subject.allow_lifecycle === false) {
    return `subject ${subject.id} does not allow lifecycle features`
  }

  if (candidate.family === 'network' && subject.allow_network === false) {
    return `subject ${subject.id} does not allow network features`
  }

  if (candidate.family === 'lifecycle') {
    const agg = aggregationsById[candidate.metric]
    const minWindowSeconds = parseWindowLimit(agg?.min_window)
    if (minWindowSeconds && candidate.window.seconds < minWindowSeconds) {
      return `lifecycle feature requires min window ${agg?.min_window}`
    }
    if (agg?.incompatible_metrics?.includes(candidate.metric)) {
      return `metric ${candidate.metric} incompatible with lifecycle aggregation`
    }
  }

  return null
}
