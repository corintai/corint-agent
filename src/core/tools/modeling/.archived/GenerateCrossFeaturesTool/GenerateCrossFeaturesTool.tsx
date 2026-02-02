import { z } from 'zod'
import type { Tool, ValidationResult, ToolUseContext } from '@tool'
import { getGenerateCrossFeaturesPrompt } from './prompt'

export const inputSchema = z.strictObject({
  crossRules: z.array(
    z.strictObject({
      features: z.array(z.string()).min(2),
      method: z.enum(['multiply', 'divide', 'subtract', 'interaction']),
    }),
  ),
  semanticValidation: z.boolean().optional().default(false),
  minSemanticScore: z.number().optional().default(0.6),
})

type Input = z.infer<typeof inputSchema>

type Output = {
  features: {
    name: string
    formula: string
    semanticScore?: number
    reasoning?: string
  }[]
  rejectedBySemantic?: number
}

export const GenerateCrossFeaturesTool: Tool<typeof inputSchema, Output> = {
  name: 'GenerateCrossFeatures',
  async description() {
    return 'Generate cross features based on defined interaction rules'
  },
  async prompt() {
    return getGenerateCrossFeaturesPrompt()
  },
  isReadOnly() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  inputSchema,
  userFacingName() {
    return 'GenerateCrossFeatures'
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
    if (input.crossRules.length === 0) {
      return { result: false, message: 'crossRules cannot be empty' }
    }
    return { result: true }
  },
  renderToolUseMessage(_input: Input, { verbose }) {
    if (verbose) {
      return 'GenerateCrossFeatures: build cross feature definitions'
    }
    return 'GenerateCrossFeatures'
  },
  renderResultForAssistant(output: Output): string {
    return [
      `Generated ${output.features.length} cross features.`,
      output.rejectedBySemantic
        ? `- Rejected by semantic validation: ${output.rejectedBySemantic}`
        : '',
    ]
      .filter(Boolean)
      .join('\n')
  },
  async *call(input: Input, { abortController }) {
    if (abortController.signal.aborted) {
      yield {
        type: 'result' as const,
        data: { features: [] },
        resultForAssistant: 'Operation cancelled',
      }
      return
    }

    const features: Output['features'] = []
    let rejected = 0

    for (const rule of input.crossRules) {
      const [left, right] = rule.features
      const semanticScore = input.semanticValidation
        ? computeSemanticScore(left, right)
        : undefined

      if (
        input.semanticValidation &&
        semanticScore !== undefined &&
        semanticScore < (input.minSemanticScore || 0)
      ) {
        rejected += 1
        continue
      }

      const name = buildCrossName(rule.method, rule.features)
      const formula = `${left} ${mapMethod(rule.method)} ${right}`
      features.push({
        name,
        formula,
        semanticScore,
        reasoning: semanticScore !== undefined ? `semantic_score=${semanticScore.toFixed(2)}` : undefined,
      })
    }

    const result: Output = {
      features,
      rejectedBySemantic: input.semanticValidation ? rejected : undefined,
    }

    yield {
      type: 'result' as const,
      data: result,
      resultForAssistant: this.renderResultForAssistant(result),
    }
  },
}

function mapMethod(method: Input['crossRules'][0]['method']): string {
  switch (method) {
    case 'multiply':
      return '*'
    case 'divide':
      return '/'
    case 'subtract':
      return '-'
    case 'interaction':
      return '*'
    default:
      return '*'
  }
}

function buildCrossName(method: string, features: string[]): string {
  const base = `cross_${method}_${features.join('__')}`
  if (base.length <= 200) return base.toLowerCase()
  const truncated = features.map(feature => feature.slice(0, 20)).join('__')
  const hash = simpleHash(base)
  return `cross_${method}_${truncated}_${hash}`.toLowerCase()
}

function computeSemanticScore(left: string, right: string): number {
  const leftTokens = new Set(left.split('_'))
  const rightTokens = new Set(right.split('_'))
  const intersection = new Set([...leftTokens].filter(token => rightTokens.has(token)))
  const union = new Set([...leftTokens, ...rightTokens])
  return union.size > 0 ? intersection.size / union.size : 0
}

function simpleHash(value: string): string {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}
