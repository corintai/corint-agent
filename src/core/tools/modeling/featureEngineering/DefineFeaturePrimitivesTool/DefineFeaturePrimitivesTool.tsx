import { z } from 'zod'
import type { Tool, ValidationResult, ToolUseContext } from '@tool'
import { loadPrimitives } from '../shared/primitives'
import type { FeaturePrimitives } from '../shared/types'
import { getDefineFeaturePrimitivesPrompt } from './prompt'

const behaviorTypeSchema = z.strictObject({
  name: z.string(),
  table: z.string(),
  timestampColumn: z.string(),
  subjectColumn: z.string().optional(),
  valueColumn: z.string().optional(),
  categoryColumn: z.string().optional(),
})

export const inputSchema = z.strictObject({
  primitivesPath: z.string().optional().describe('Path to feature_primitives.yaml'),
  objects: z.array(z.string()).optional().describe('Object list override'),
  dimensions: z.array(z.string()).optional().describe('Dimension list override'),
  events: z
    .array(
      z.strictObject({
        id: z.string(),
        name: z.string().optional(),
      }),
    )
    .optional()
    .describe('Event list override'),
  windows: z
    .array(z.union([z.string(), z.number()]))
    .optional()
    .describe('Custom window list (e.g., ["7d", "30d"] or [7,30])'),
  windowUnit: z
    .enum(['s', 'm', 'h', 'd', 'w', 'mo', 'y'])
    .optional()
    .default('d')
    .describe('Unit for numeric windows'),
  anchorTime: z.string().optional().describe('Anchor time column'),
  behaviorTypes: z
    .array(behaviorTypeSchema)
    .optional()
    .describe('Behavior type mappings for feature SQL generation'),
})

type Input = z.infer<typeof inputSchema>

type Output = {
  primitiveId: string
  primitives: FeaturePrimitives
  config: {
    anchorTime?: string
    behaviorTypes?: z.infer<typeof behaviorTypeSchema>[]
  }
}

export const DefineFeaturePrimitivesTool: Tool<typeof inputSchema, Output> = {
  name: 'DefineFeaturePrimitives',
  async description() {
    return 'Load and customize feature primitives for automated feature generation'
  },
  async prompt() {
    return getDefineFeaturePrimitivesPrompt()
  },
  isReadOnly() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  inputSchema,
  userFacingName() {
    return 'DefineFeaturePrimitives'
  },
  async isEnabled() {
    return true
  },
  needsPermissions() {
    return true
  },
  async validateInput(
    { primitivesPath }: Input,
    _context?: ToolUseContext,
  ): Promise<ValidationResult> {
    if (primitivesPath && primitivesPath.trim().length === 0) {
      return { result: false, message: 'primitivesPath cannot be empty' }
    }
    return { result: true }
  },
  renderToolUseMessage({ primitivesPath }: Input, { verbose }) {
    if (verbose) {
      return `DefineFeaturePrimitives: ${primitivesPath || 'docs/feature_primitives.yaml'}`
    }
    return 'DefineFeaturePrimitives'
  },
  renderResultForAssistant(output: Output): string {
    return [
      `Feature primitives loaded.`,
      `- Primitive ID: ${output.primitiveId}`,
      `- Subjects: ${output.primitives.subjects.length}`,
      `- Events: ${output.primitives.events.length}`,
      `- Window groups: ${Object.keys(output.primitives.time_windows || {}).length}`,
    ].join('\n')
  },
  async *call(input: Input, { abortController }) {
    if (abortController.signal.aborted) {
      yield {
        type: 'result' as const,
        data: {
          primitiveId: 'cancelled',
          primitives: {
            version: '0',
            subjects: [],
            time_windows: {},
            events: [],
            aggregations: {},
            calculation_methods: [],
            naming_convention: {
              template: '',
              required: [],
              optional: [],
              separator: '_',
              max_length: 200,
              validation: [],
            },
          },
          config: {},
        },
        resultForAssistant: 'Operation cancelled',
      }
      return
    }

    const { primitives } = await loadPrimitives(input.primitivesPath)
    const customized: FeaturePrimitives = {
      ...primitives,
      objects: input.objects ?? primitives.objects,
      dimensions: input.dimensions ?? primitives.dimensions,
      events: input.events
        ? input.events.map(event => ({
            id: event.id,
            name: event.name || event.id,
          }))
        : primitives.events,
    }

    if (input.windows && input.windows.length > 0) {
      const parsedValues = input.windows.map(win =>
        typeof win === 'number'
          ? win
          : Number(String(win).replace(/[a-z]+$/i, '')),
      )
      customized.time_windows = {
        custom: {
          unit: input.windowUnit || 'd',
          values: parsedValues.filter(v => !Number.isNaN(v)),
          description: 'Custom window list',
        },
      }
    }

    const result: Output = {
      primitiveId: `${customized.namespace || 'primitives'}_${Date.now()}`,
      primitives: customized,
      config: {
        anchorTime: input.anchorTime,
        behaviorTypes: input.behaviorTypes,
      },
    }

    yield {
      type: 'result' as const,
      data: result,
      resultForAssistant: this.renderResultForAssistant(result),
    }
  },
}
