import { z } from 'zod'
import type { Tool, ValidationResult, ToolUseContext } from '@tool'
import { loadPrimitives } from '../shared/primitives'
import { generateCandidates } from '../shared/candidates'
import { validateCandidateAgainstPrimitives } from '../shared/candidateValidation'
import type { FeatureCandidate } from '../shared/types'
import { getGenerateWindowFeaturesPrompt } from './prompt'

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
  primitivesPath: z.string().optional(),
  candidates: z.array(candidateSchema).optional(),
  generation: generationSchema.optional(),
  outputTable: z.string().optional(),
  includeReasoning: z.boolean().optional().default(true),
})

type Input = z.infer<typeof inputSchema>

type Output = {
  outputTable?: string
  features: {
    name: string
    description: string
    type: 'numeric' | 'categorical'
    formula: string
    reasoning?: string
  }[]
  statistics: {
    totalGenerated: number
    executionTime: number
  }
}

export const GenerateWindowFeaturesTool: Tool<typeof inputSchema, Output> = {
  name: 'GenerateWindowFeatures',
  async description() {
    return 'Generate base window aggregation feature definitions from primitives'
  },
  async prompt() {
    return getGenerateWindowFeaturesPrompt()
  },
  isReadOnly() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  inputSchema,
  userFacingName() {
    return 'GenerateWindowFeatures'
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
        message: 'Provide candidates or generation options',
      }
    }
    return { result: true }
  },
  renderToolUseMessage(_input: Input, { verbose }) {
    if (verbose) {
      return 'GenerateWindowFeatures: build base feature definitions'
    }
    return 'GenerateWindowFeatures'
  },
  renderResultForAssistant(output: Output): string {
    return [
      `Generated ${output.statistics.totalGenerated} window features.`,
      output.outputTable ? `- Output table: ${output.outputTable}` : '',
    ]
      .filter(Boolean)
      .join('\n')
  },
  async *call(input: Input, { abortController }) {
    if (abortController.signal.aborted) {
      yield {
        type: 'result' as const,
        data: { features: [], statistics: { totalGenerated: 0, executionTime: 0 } },
        resultForAssistant: 'Operation cancelled',
      }
      return
    }

    const start = Date.now()
    const { primitives } = await loadPrimitives(input.primitivesPath)
    const families =
      input.generation?.families && input.generation.families.length > 0
        ? input.generation.families
        : ['basic']

    const candidates =
      (input.candidates as FeatureCandidate[] | undefined) ||
      generateCandidates(primitives, {
        subjects: input.generation?.subjects,
        metrics: input.generation?.metrics,
        families: families as any,
        objects: input.generation?.objects,
        events: input.generation?.events,
        dimensions: input.generation?.dimensions,
        windows: input.generation?.windows,
        includeCalculationMethods: input.generation?.includeCalculationMethods,
      })

    const validCandidates = candidates.filter(
      candidate => validateCandidateAgainstPrimitives(candidate, primitives).valid,
    )

    const features = validCandidates.map(candidate =>
      buildFeatureDefinition(candidate, primitives, input.includeReasoning ?? true),
    )

    const result: Output = {
      outputTable: input.outputTable,
      features,
      statistics: {
        totalGenerated: features.length,
        executionTime: Date.now() - start,
      },
    }

    yield {
      type: 'result' as const,
      data: result,
      resultForAssistant: this.renderResultForAssistant(result),
    }
  },
}

function buildFeatureDefinition(
  candidate: FeatureCandidate,
  primitives: Awaited<ReturnType<typeof loadPrimitives>>['primitives'],
  includeReasoning: boolean,
) {
  const subject = primitives.subjects.find(s => s.id === candidate.subjectId)
  const aggregation = Object.values(primitives.aggregations || {})
    .flatMap(list => list || [])
    .find(agg => agg.id === candidate.metric)

  const parts = [
    candidate.metric,
    candidate.object,
    candidate.event,
    candidate.dimension,
  ].filter(Boolean)
  const base = parts.join('_')
  const formula = candidate.calculation
    ? `${candidate.calculation}(${base}) over ${candidate.window.label}`
    : `${base} over ${candidate.window.label}`

  const description = `${subject?.name || candidate.subjectPrefix} ${aggregation?.name || candidate.metric} ${candidate.object}${
    candidate.event ? ` (${candidate.event})` : ''
  }${candidate.dimension ? ` by ${candidate.dimension}` : ''} within ${candidate.window.label}`

  return {
    name: candidate.name,
    description,
    type: 'numeric' as const,
    formula,
    reasoning: includeReasoning
      ? `Derived from ${candidate.subjectId} using ${candidate.metric} over ${candidate.window.label}`
      : undefined,
  }
}
