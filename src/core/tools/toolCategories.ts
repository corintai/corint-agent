/**
 * Tool categorization for documentation and organization purposes
 *
 * All tools are now loaded by default (no conditional loading).
 * This categorization is kept for documentation and potential future use.
 */

export const CORE_TOOLS: readonly string[] = [
  // File operations (essential)
  'Read',
  'Edit',
  'Write',
  'Glob',
  'Grep',

  // System operations
  'Bash',
  'TaskOutput',
  'KillShell',

  // User interaction
  'AskUserQuestion',

  // Todo management
  'TodoWrite',
  'TodoGet',
  'TodoUpdate',
  'TodoList',

  // Commands and skills
  'SlashCommand',
  'Skill',

  // Agent delegation
  'Task',

  // Network operations
  'WebSearch',
  'WebFetch',
]

export const TOOL_CATEGORIES = {
  // Data query and analysis
  data: [
    'InspectDatabase',  // Merged: ListDataSources + ExploreSchema
    'QuerySQL',
    'AnalyzeLocalFile',
    'FileConverter',  // Merged: ConvertToParquet + ConvertExcelToCSV
  ],

  // Credit modeling and feature engineering (5 consolidated tools)
  modeling: [
    'AnalyzeDataQuality',      // Merged 8 tools: ProfileDataset, ComputeMissingRate, DetectSingleValue, ComputeVariance, ComputeEntropy, ComputeQuantileCollapse, ComputeTemporalConsistency, DetectCollinearity
    'EvaluateFeatures',        // Merged 3 tools: ComputeIv, ComputePsi, ComputeCoverage
    'DefineFeaturePrimitives', // Kept independent
    'GenerateFeatures',        // Merged 4 tools: GenerateWindowFeatures, GenerateRatioFeatures, GenerateCrossFeatures, GenerateCreditFeatures
    'OptimizeFeatures',        // Merged 3 tools: SemanticPruning, ProxyEvaluation, BeamSearchFeatures
  ],
} as const

export type ToolCategory = keyof typeof TOOL_CATEGORIES

export function getToolCategory(toolName: string): ToolCategory | 'core' | null {
  if (CORE_TOOLS.includes(toolName)) {
    return 'core'
  }

  const entries = Object.entries(TOOL_CATEGORIES) as Array<
    [ToolCategory, readonly string[]]
  >
  for (const [category, tools] of entries) {
    if (tools.includes(toolName)) {
      return category as ToolCategory
    }
  }

  return null
}

export function getCategoryDescription(category: ToolCategory): string {
  const descriptions: Record<ToolCategory, string> = {
    data: 'Database queries, schema exploration, local file analysis, file format conversion',
    modeling:
      'Credit modeling (5 tools): data quality analysis, feature evaluation, primitive definition, feature generation, and optimization',
  }
  return descriptions[category]
}
