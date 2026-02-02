/**
 * Tool categorization for smart tool selection
 * Core tools are always included, optional tools are selected based on user intent
 */

export const CORE_TOOLS = [
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

  // Plan mode
  'EnterPlanMode',
  'ExitPlanMode',

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
  'AskExpertModel',

  // Network operations
  'WebSearch',
  'WebFetch',
] as const

export const TOOL_CATEGORIES = {
  // Data query and analysis
  data: [
    'QuerySQL',
    'ExploreSchema',
    'ListDataSources',
    'AnalyzeLocalFile',
    'ConvertToParquet',
    'ConvertExcelToCSV',
  ],

  // Credit modeling and feature engineering
  credit: [
    'ProfileDataset',
    'ComputeMissingRate',
    'ComputePsi',
    'ComputeIv',
    'ComputeCoverage',
    'DetectSingleValue',
    'ComputeVariance',
    'ComputeEntropy',
    'ComputeQuantileCollapse',
    'ComputeTemporalConsistency',
    'DetectCollinearity',
  ],

  // Feature engineering
  feature: [
    'DefineFeaturePrimitives',
    'SemanticPruning',
    'ProxyEvaluation',
    'BeamSearchFeatures',
    'GenerateWindowFeatures',
    'GenerateRatioFeatures',
    'GenerateCrossFeatures',
    'GenerateCreditFeatures',
  ],

  // Notebook operations
  notebook: ['NotebookEdit'],

  // MCP integration
  mcp: ['ListMcpResources', 'ReadMcpResource', 'MCPTool'],
} as const

export type ToolCategory = keyof typeof TOOL_CATEGORIES

export function getToolCategory(toolName: string): ToolCategory | 'core' | null {
  if (CORE_TOOLS.includes(toolName as any)) {
    return 'core'
  }

  for (const [category, tools] of Object.entries(TOOL_CATEGORIES)) {
    if (tools.includes(toolName as any)) {
      return category as ToolCategory
    }
  }

  return null
}

export function getCategoryDescription(category: ToolCategory): string {
  const descriptions: Record<ToolCategory, string> = {
    data: 'Database queries, schema exploration, local file analysis, data format conversion',
    credit: 'Credit risk modeling, data profiling, statistical analysis (IV, PSI, variance, entropy, etc.)',
    feature: 'Feature engineering, semantic pruning, proxy evaluation, beam search, feature generation',
    notebook: 'Jupyter notebook editing',
    mcp: 'MCP (Model Context Protocol) resource access',
  }
  return descriptions[category]
}
