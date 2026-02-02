import { z } from 'zod'
import type { Tool } from '@tool'
import { loadPrimitives } from '../shared/primitives'
import type { FeatureCandidate, FeatureFamily } from '../shared/types'
import { candidateToName } from '../shared/naming'
import { scoreCandidate } from '../shared/scoring'
import { validateCandidateAgainstPrimitives } from '../shared/candidateValidation'
import { getBeamSearchPrompt } from './prompt'

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

const scoredCandidateSchema = z.strictObject({
  candidate: candidateSchema,
  proxyScore: z.number(),
})

export const inputSchema = z.strictObject({
  primitivesPath: z.string().optional(),
  candidates: z.array(z.union([candidateSchema, scoredCandidateSchema])),
  beamWidth: z.number().optional().default(50),
  budget: z
    .strictObject({
      total: z.number().optional(),
      per_subject: z.record(z.number()).optional(),
      per_family: z.record(z.number()).optional(),
      per_window: z.record(z.number()).optional(),
    })
    .optional(),
  searchStrategy: z
    .strictObject({
      rounds: z.number().optional().default(3),
      derivation: z.boolean().optional().default(false),
      crossFeatures: z.boolean().optional().default(false),
    })
    .optional(),
})

type Input = z.infer<typeof inputSchema>

type Output = {
  selectedFeatures: {
    name: string
    formula: string
    importance: number
    family: string
  }[]
  budgetUsage: {
    total: { used: number; limit: number }
    per_subject: Record<string, { used: number; limit: number }>
  }
  statistics: {
    computeCost: string
  }
}

export const BeamSearchFeaturesTool: Tool<typeof inputSchema, Output> = {
  name: 'BeamSearchFeatures',
  async description() {
    return 'Select an optimal feature subset under budget constraints using beam search heuristics'
  },
  async prompt() {
    return getBeamSearchPrompt()
  },
  isReadOnly() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  inputSchema,
  userFacingName() {
    return 'BeamSearchFeatures'
  },
  async isEnabled() {
    return true
  },
  needsPermissions() {
    return true
  },
  renderToolUseMessage(_input: Input, { verbose }) {
    if (verbose) {
      return 'BeamSearchFeatures: select candidates under budget constraints'
    }
    return 'BeamSearchFeatures'
  },
  renderResultForAssistant(output: Output): string {
    return [
      `Beam search selection completed.`,
      `- Selected features: ${output.selectedFeatures.length}`,
      `- Budget used: ${output.budgetUsage.total.used}/${output.budgetUsage.total.limit}`,
    ].join('\n')
  },
  async *call(input: Input, { abortController }) {
    if (abortController.signal.aborted) {
      yield {
        type: 'result' as const,
        data: {
          selectedFeatures: [],
          budgetUsage: { total: { used: 0, limit: 0 }, per_subject: {} },
          statistics: { computeCost: '0' },
        },
        resultForAssistant: 'Operation cancelled',
      }
      return
    }

    const { primitives, subjectsById } = await loadPrimitives(input.primitivesPath)
    const budget = input.budget || primitives.constraints?.feature_budget || {}
    const totalLimit = budget.total ?? 500

    const scoringCandidates = normalizeCandidates(
      input.candidates as Array<FeatureCandidate | { candidate: FeatureCandidate; proxyScore: number }>,
      primitives,
      subjectsById,
    ).filter(entry =>
      validateCandidateAgainstPrimitives(entry.candidate, primitives).valid,
    )

    if (input.searchStrategy?.derivation) {
      const derived = deriveCandidates(scoringCandidates, primitives)
      scoringCandidates.push(...derived)
    }

    const beamWidth = input.beamWidth ?? 50
    const rounds = input.searchStrategy?.rounds ?? 3

    const sorted = scoringCandidates
      .sort((a, b) => b.score - a.score)
      .slice(0, beamWidth * rounds)

    const selected: FeatureCandidate[] = []
    const usage = {
      total: 0,
      per_subject: {} as Record<string, number>,
      per_family: {} as Record<string, number>,
      per_window: {} as Record<string, number>,
    }

    for (const entry of sorted) {
      if (selected.length >= totalLimit) break
      if (!canUseBudget(entry.candidate, budget, usage)) {
        continue
      }

      selected.push(entry.candidate)
      incrementUsage(entry.candidate, usage)
    }

    const selectedFeatures = selected.map(candidate => ({
      name: candidate.name,
      formula: buildFormula(candidate),
      importance: Math.max(
        0,
        scoringCandidates.find(item => item.candidate.name === candidate.name)?.score || 0,
      ),
      family: candidate.family,
    }))

    const budgetUsage = {
      total: { used: selected.length, limit: totalLimit },
      per_subject: buildBudgetUsage(usage.per_subject, budget.per_subject),
    }

    const result: Output = {
      selectedFeatures,
      budgetUsage,
      statistics: {
        computeCost: 'O(K × depth) heuristic',
      },
    }

    yield {
      type: 'result' as const,
      data: result,
      resultForAssistant: this.renderResultForAssistant(result),
    }
  },
}

type ScoredCandidate = {
  candidate: FeatureCandidate
  score: number
}

function normalizeCandidates(
  candidates: Array<FeatureCandidate | { candidate: FeatureCandidate; proxyScore: number }>,
  primitives: Awaited<ReturnType<typeof loadPrimitives>>['primitives'],
  subjectsById: Awaited<ReturnType<typeof loadPrimitives>>['subjectsById'],
): ScoredCandidate[] {
  const normalized: ScoredCandidate[] = []
  for (const entry of candidates) {
    if ('candidate' in entry) {
      normalized.push({ candidate: entry.candidate, score: entry.proxyScore })
    } else {
      const subject = subjectsById[entry.subjectId]
      normalized.push({
        candidate: entry,
        score: scoreCandidate(entry, subject),
      })
    }
  }
  return normalized
}

function deriveCandidates(
  candidates: ScoredCandidate[],
  primitives: Awaited<ReturnType<typeof loadPrimitives>>['primitives'],
): ScoredCandidate[] {
  const calculationPrefixes = primitives.calculation_methods?.map(m => m.prefix) || []
  const derived: ScoredCandidate[] = []
  const seen = new Set(candidates.map(c => c.candidate.name))

  for (const entry of candidates) {
    if (entry.candidate.calculation) continue
    for (const prefix of calculationPrefixes) {
      const family = mapCalculationToFamily(prefix)
      const next: FeatureCandidate = {
        ...entry.candidate,
        calculation: prefix,
        family,
        name: candidateToName(
          { ...entry.candidate, calculation: prefix, family } as FeatureCandidate,
          primitives,
        ),
      }
      if (seen.has(next.name)) continue
      seen.add(next.name)
      derived.push({ candidate: next, score: entry.score * 0.9 })
    }
  }

  return derived
}

function mapCalculationToFamily(prefix: string): FeatureFamily {
  if (prefix === 'ratio' || prefix === 'rate') return 'ratio'
  if (
    prefix === 'mom' ||
    prefix === 'yoy' ||
    prefix === 'grad' ||
    prefix === 'slope' ||
    prefix === 'incr' ||
    prefix === 'diff'
  ) {
    return 'trend'
  }
  return 'basic'
}

function canUseBudget(
  candidate: FeatureCandidate,
  budget: {
    total?: number
    per_subject?: Record<string, number>
    per_family?: Record<string, number>
    per_window?: Record<string, number>
  },
  usage: {
    total: number
    per_subject: Record<string, number>
    per_family: Record<string, number>
    per_window: Record<string, number>
  },
): boolean {
  if (budget.total && usage.total >= budget.total) return false

  if (budget.per_subject) {
    const limit = budget.per_subject[candidate.subjectId]
    if (limit !== undefined && (usage.per_subject[candidate.subjectId] || 0) >= limit) {
      return false
    }
  }

  if (budget.per_family) {
    const limit = budget.per_family[candidate.family]
    if (limit !== undefined && (usage.per_family[candidate.family] || 0) >= limit) {
      return false
    }
  }

  if (budget.per_window) {
    const key = candidate.windowGroupType || candidate.windowGroup || 'default'
    const limit = budget.per_window[key]
    if (limit !== undefined && (usage.per_window[key] || 0) >= limit) {
      return false
    }
  }

  return true
}

function incrementUsage(
  candidate: FeatureCandidate,
  usage: {
    total: number
    per_subject: Record<string, number>
    per_family: Record<string, number>
    per_window: Record<string, number>
  },
) {
  usage.total += 1
  usage.per_subject[candidate.subjectId] =
    (usage.per_subject[candidate.subjectId] || 0) + 1
  usage.per_family[candidate.family] = (usage.per_family[candidate.family] || 0) + 1
  const key = candidate.windowGroupType || candidate.windowGroup || 'default'
  usage.per_window[key] = (usage.per_window[key] || 0) + 1
}

function buildBudgetUsage(
  usage: Record<string, number>,
  limits?: Record<string, number>,
): Record<string, { used: number; limit: number }> {
  const output: Record<string, { used: number; limit: number }> = {}
  const limitKeys = limits ? Object.keys(limits) : []
  const keys = new Set([...Object.keys(usage), ...limitKeys])
  for (const key of keys) {
    output[key] = { used: usage[key] || 0, limit: limits?.[key] ?? 0 }
  }
  return output
}

function buildFormula(candidate: FeatureCandidate): string {
  const parts = [
    candidate.metric,
    candidate.object,
    candidate.event,
    candidate.dimension,
  ].filter(Boolean)
  const base = `${parts.join('_')}`
  const calc = candidate.calculation ? `${candidate.calculation}(${base})` : base
  return `${calc} over ${candidate.window.label}`
}
