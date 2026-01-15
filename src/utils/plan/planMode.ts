/**
 * Plan Mode (Legacy Re-exports)
 *
 * This file re-exports from the new agent/planner module for backward compatibility.
 * New code should import directly from '@agent' or '@agent/planner'.
 */

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
} from '@agent/planner'
