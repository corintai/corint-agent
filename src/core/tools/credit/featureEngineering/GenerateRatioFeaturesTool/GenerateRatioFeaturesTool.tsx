import { z } from 'zod'
import type { Tool, ValidationResult, ToolUseContext } from '@tool'
import { loadPrimitives } from '../shared/primitives'
import { buildFeatureName, parseFeatureName } from '../shared/naming'
import { getGenerateRatioFeaturesPrompt } from './prompt'

export const inputSchema = z.strictObject({
  primitivesPath: z.string().optional(),
  baseFeatures: z.array(z.string()).describe('Base feature names'),
  ratioRules: z
    .array(
      z.strictObject({
        numerator: z.string(),
        denominator: z.string(),
      }),
    )
    .optional(),
  autoGenerate: z.boolean().optional().default(false),
})

type Input = z.infer<typeof inputSchema>

type Output = {
  features: {
    name: string
    formula: string
  }[]
}

export const GenerateRatioFeaturesTool: Tool<typeof inputSchema, Output> = {
  name: 'GenerateRatioFeatures',
  async description() {
    return 'Generate ratio features from base feature names'
  },
  async prompt() {
    return getGenerateRatioFeaturesPrompt()
  },
  isReadOnly() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  inputSchema,
  userFacingName() {
    return 'GenerateRatioFeatures'
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
    if (!input.autoGenerate && (!input.ratioRules || input.ratioRules.length === 0)) {
      return {
        result: false,
        message: 'Provide ratioRules or enable autoGenerate',
      }
    }
    return { result: true }
  },
  renderToolUseMessage(_input: Input, { verbose }) {
    if (verbose) {
      return 'GenerateRatioFeatures: build ratio feature definitions'
    }
    return 'GenerateRatioFeatures'
  },
  renderResultForAssistant(output: Output): string {
    return `Generated ${output.features.length} ratio features.`
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

    const { primitives } = await loadPrimitives(input.primitivesPath)
    const features: Output['features'] = []
    const seen = new Set<string>()

    if (input.ratioRules) {
      for (const rule of input.ratioRules) {
        const numeratorParts = parseFeatureName(rule.numerator, primitives)
        if (!numeratorParts) continue
        const name = buildFeatureName(
          {
            ...numeratorParts,
            calculation: 'ratio',
            window: numeratorParts.window,
            windowPair: numeratorParts.windowPair,
          },
          primitives,
        )
        if (seen.has(name)) continue
        seen.add(name)
        features.push({
          name,
          formula: `${rule.numerator} / NULLIF(${rule.denominator}, 0)`,
        })
      }
    }

    if (input.autoGenerate) {
      const parsed = input.baseFeatures
        .map(feature => ({
          name: feature,
          parts: parseFeatureName(feature, primitives),
        }))
        .filter(item => item.parts)

      const groups = new Map<string, { base?: string; dimensions: string[] }>()
      for (const item of parsed) {
        const parts = item.parts!
        const key = [
          parts.subject,
          parts.metric,
          parts.object,
          parts.event || '',
          parts.window || parts.windowPair || '',
        ].join('|')

        const entry = groups.get(key) || { dimensions: [] }
        if (!parts.dimension) {
          entry.base = item.name
        } else {
          entry.dimensions.push(item.name)
        }
        groups.set(key, entry)
      }

      for (const group of groups.values()) {
        if (!group.base) continue
        for (const dimFeature of group.dimensions) {
          const numeratorParts = parseFeatureName(dimFeature, primitives)
          if (!numeratorParts) continue
          const name = buildFeatureName(
            {
              ...numeratorParts,
              calculation: 'ratio',
            },
            primitives,
          )
          if (seen.has(name)) continue
          seen.add(name)
          features.push({
            name,
            formula: `${dimFeature} / NULLIF(${group.base}, 0)`,
          })
        }
      }
    }

    const result: Output = { features }
    yield {
      type: 'result' as const,
      data: result,
      resultForAssistant: this.renderResultForAssistant(result),
    }
  },
}
