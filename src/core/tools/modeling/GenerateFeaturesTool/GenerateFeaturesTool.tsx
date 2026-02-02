import { z } from 'zod'
import type { Tool, ValidationResult, ToolUseContext } from '@tool'
import { getGenerateFeaturesPrompt } from './prompt'
import type {
  FeatureType,
  GenerationConfig,
  GenerateFeaturesOutput,
  GeneratedFeature,
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
  primitivesPath: z.string().optional().describe('Path to feature primitives file'),
  featureTypes: z
    .array(z.enum(['window', 'ratio', 'cross', 'credit']))
    .describe('Types of features to generate'),
  candidates: z
    .array(candidateSchema)
    .optional()
    .describe('Pre-defined feature candidates'),
  generation: generationSchema.optional().describe('Generation configuration'),
  outputTable: z.string().optional().describe('Output table name'),
  includeReasoning: z
    .boolean()
    .optional()
    .default(true)
    .describe('Include reasoning for each feature'),
})

type Input = z.infer<typeof inputSchema>

export const GenerateFeaturesTool: Tool<typeof inputSchema, GenerateFeaturesOutput> = {
  name: 'GenerateFeatures',
  async description() {
    return 'Generate features for credit modeling (window, ratio, cross, credit types)'
  },
  async prompt() {
    return getGenerateFeaturesPrompt()
  },
  isReadOnly() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  inputSchema,
  userFacingName() {
    return 'GenerateFeatures'
  },
  async isEnabled() {
    return true
  },
  needsPermissions(): boolean {
    return true
  },
  async validateInput(
    { primitivesPath, candidates, generation }: Input,
    _context?: ToolUseContext,
  ): Promise<ValidationResult> {
    if (!primitivesPath && !candidates) {
      return {
        result: false,
        message: 'Must provide either primitivesPath or candidates',
      }
    }
    return { result: true }
  },

  renderToolUseMessage(
    { featureTypes, candidates, generation }: Input,
    { verbose },
  ) {
    if (verbose) {
      const count = candidates?.length || 'auto'
      return `GenerateFeatures: ${featureTypes.join(', ')} (${count} candidates)`
    }
    return `GenerateFeatures: ${featureTypes.join(', ')}`
  },

  renderResultForAssistant(output: GenerateFeaturesOutput): string {
    const lines: string[] = ['Feature Generation Results:', '']

    lines.push(`## Statistics`)
    lines.push(`- Total generated: ${output.statistics.totalGenerated}`)
    lines.push(`- Execution time: ${output.statistics.executionTime}ms`)
    lines.push('')

    lines.push('By type:')
    Object.entries(output.statistics.byType).forEach(([type, count]) => {
      lines.push(`  - ${type}: ${count}`)
    })
    lines.push('')

    if (output.outputTable) {
      lines.push(`Output table: ${output.outputTable}`)
      lines.push('')
    }

    lines.push('## Generated Features')
    output.features.slice(0, 10).forEach(feature => {
      lines.push(`### ${feature.name}`)
      lines.push(`- Type: ${feature.type}`)
      lines.push(`- Description: ${feature.description}`)
      lines.push(`- Formula: ${feature.formula}`)
      if (feature.reasoning) {
        lines.push(`- Reasoning: ${feature.reasoning}`)
      }
      lines.push('')
    })

    if (output.features.length > 10) {
      lines.push(`... and ${output.features.length - 10} more features`)
    }

    return lines.join('\n')
  },

  async *call(
    {
      primitivesPath,
      featureTypes,
      candidates,
      generation,
      outputTable,
      includeReasoning,
    }: Input,
    { abortController },
  ) {
    try {
      if (abortController.signal.aborted) {
        yield {
          type: 'result' as const,
          data: {
            features: [],
            statistics: {
              totalGenerated: 0,
              byType: { window: 0, ratio: 0, cross: 0, credit: 0 },
              executionTime: 0,
            },
          },
          resultForAssistant: 'Operation cancelled',
        }
        return
      }

      const startTime = Date.now()

      // TODO: Implement actual feature generation logic
      // For now, return a placeholder response
      const features: GeneratedFeature[] = []
      const byType: Record<FeatureType, number> = {
        window: 0,
        ratio: 0,
        cross: 0,
        credit: 0,
      }

      // Placeholder: Generate mock features based on types
      for (const type of featureTypes) {
        const mockFeature: GeneratedFeature = {
          name: `${type}_feature_example`,
          description: `Example ${type} feature`,
          type: 'numeric',
          formula: `SELECT ${type}_calculation()`,
          reasoning: includeReasoning
            ? `Generated as example ${type} feature`
            : undefined,
        }
        features.push(mockFeature)
        byType[type] = (byType[type] || 0) + 1
      }

      const executionTime = Date.now() - startTime

      const result: GenerateFeaturesOutput = {
        outputTable,
        features,
        statistics: {
          totalGenerated: features.length,
          byType,
          executionTime,
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
      yield {
        type: 'result' as const,
        data: {
          features: [],
          statistics: {
            totalGenerated: 0,
            byType: { window: 0, ratio: 0, cross: 0, credit: 0 },
            executionTime: 0,
          },
        },
        resultForAssistant: `Feature generation failed: ${errorMessage}`,
      }
    }
  },
}
