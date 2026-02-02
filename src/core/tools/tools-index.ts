import { memoize } from 'lodash-es'
import { Tool } from '@tool'
import { AskUserQuestionTool } from './interaction/AskUserQuestionTool/AskUserQuestionTool'
import { BashTool } from './system/BashTool/BashTool'
import { TaskOutputTool } from './system/TaskOutputTool/TaskOutputTool'
import { FileEditTool } from './filesystem/FileEditTool/FileEditTool'
import { FileReadTool } from './filesystem/FileReadTool/FileReadTool'
import { FileWriteTool } from './filesystem/FileWriteTool/FileWriteTool'
import { GlobTool } from './filesystem/GlobTool/GlobTool'
import { GrepTool } from './search/GrepTool/GrepTool'
import { KillShellTool } from './system/KillShellTool/KillShellTool'
import { SlashCommandTool } from './interaction/SlashCommandTool/SlashCommandTool'
import { SkillTool } from './ai/SkillTool/SkillTool'
import { TaskTool } from './agent/TaskTool/TaskTool'
import { TodoWriteTool } from './interaction/TodoWriteTool/TodoWriteTool'
import { WebFetchTool } from './network/WebFetchTool/WebFetchTool'
import { WebSearchTool } from './network/WebSearchTool/WebSearchTool'
// Data tools for risk management
import { InspectDatabaseTool } from './data/InspectDatabaseTool/InspectDatabaseTool'
import { QuerySQLTool } from './data/QuerySQLTool/QuerySQLTool'
import { AnalyzeLocalFileTool } from './data/AnalyzeLocalFileTool/AnalyzeLocalFileTool'
import { FileConverterTool } from './data/FileConverterTool/FileConverterTool'
// Credit modeling tools (consolidated)
import { AnalyzeDataQualityTool } from './modeling/AnalyzeDataQualityTool/AnalyzeDataQualityTool'
import { EvaluateFeaturesTool } from './modeling/EvaluateFeaturesTool/EvaluateFeaturesTool'
import { DefineFeaturePrimitivesTool } from './modeling/featureEngineering/DefineFeaturePrimitivesTool/DefineFeaturePrimitivesTool'
import { GenerateFeaturesTool } from './modeling/GenerateFeaturesTool/GenerateFeaturesTool'
import { OptimizeFeaturesTool } from './modeling/OptimizeFeaturesTool/OptimizeFeaturesTool'

export const getAllTools = (): Tool[] => [
  TaskTool as unknown as Tool,
  BashTool as unknown as Tool,
  TaskOutputTool as unknown as Tool,
  KillShellTool as unknown as Tool,
  GlobTool as unknown as Tool,
  GrepTool as unknown as Tool,
  FileReadTool as unknown as Tool,
  FileEditTool as unknown as Tool,
  FileWriteTool as unknown as Tool,
  TodoWriteTool as unknown as Tool,
  WebSearchTool as unknown as Tool,
  WebFetchTool as unknown as Tool,
  AskUserQuestionTool as unknown as Tool,
  SlashCommandTool as unknown as Tool,
  SkillTool as unknown as Tool,
  // Data tools
  InspectDatabaseTool as unknown as Tool,
  QuerySQLTool as unknown as Tool,
  AnalyzeLocalFileTool as unknown as Tool,
  FileConverterTool as unknown as Tool,
  // Credit modeling tools (5 consolidated tools)
  AnalyzeDataQualityTool as unknown as Tool,
  EvaluateFeaturesTool as unknown as Tool,
  DefineFeaturePrimitivesTool as unknown as Tool,
  GenerateFeaturesTool as unknown as Tool,
  OptimizeFeaturesTool as unknown as Tool,
]

export const getTools = memoize(
  async (_includeOptional?: boolean): Promise<Tool[]> => {
    const tools = getAllTools()
    // Note: MCP tools are disabled but the service remains for compatibility

    const isEnabled = await Promise.all(tools.map(tool => tool.isEnabled()))
    return tools.filter((_, i) => isEnabled[i])
  },
)

export const getReadOnlyTools = memoize(async (): Promise<Tool[]> => {
  const tools = getAllTools().filter(tool => tool.isReadOnly())
  const isEnabled = await Promise.all(tools.map(tool => tool.isEnabled()))
  return tools.filter((_, index) => isEnabled[index])
})
