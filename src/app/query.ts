/**
 * Query Module (Legacy Re-exports)
 *
 * This file re-exports from the new agent module for backward compatibility.
 * New code should import directly from '@agent' or '@agent/orchestrator'.
 */

// Re-export types
export type {
  Message,
  UserMessage,
  AssistantMessage,
  ProgressMessage,
  Response,
  BinaryFeedbackResult,
} from '@agent'

// Re-export main query function
export { query } from '@agent'

// Re-export executor utilities
export {
  normalizeToolInput,
  __ToolUseQueueForTests,
} from '@agent'

// Re-export type guard
export { isToolUseLikeBlock as __isToolUseLikeBlockForTests } from '@agent'
