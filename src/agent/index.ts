/**
 * Agent Module
 *
 * Central module for Agent orchestration, execution, and planning.
 */

// Types
export type {
  Message,
  UserMessage,
  AssistantMessage,
  ProgressMessage,
  Response,
  ExtendedToolUseContext,
  BinaryFeedbackResult,
  HookState,
  ToolQueueEntry,
  ToolUseLikeBlock,
  ToolUseQueueOptions,
} from './types'

export { isToolUseLikeBlock } from './types'

// Orchestrator
export { query } from './orchestrator'

// Executor
export {
  ToolUseQueue,
  runToolUse,
  normalizeToolInput,
  __ToolUseQueueForTests,
} from './executor'

// Planner (re-export from planner.ts)
export {
  isPlanModeEnabled,
  enterPlanMode,
  enterPlanModeForConversationKey,
  exitPlanMode,
  exitPlanModeForConversationKey,
  getPlanFilePath,
  getPlanDirectory,
  readPlanFile,
  getPlanModeSystemPromptAdditions,
  hydratePlanSlugFromMessages,
  getPlanConversationKey,
  setActivePlanConversationKey,
  getActivePlanConversationKey,
  setPlanSlug,
  getPlanSlugForConversationKey,
  isPlanFilePathForActiveConversation,
  isMainPlanFilePathForActiveConversation,
  isPathInPlanDirectory,
  __resetPlanModeForTests,
} from './planner'
