/**
 * Agent Core Types
 *
 * Central type definitions for the Agent orchestration system.
 */

import type {
  Message as APIAssistantMessage,
  MessageParam,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/index.mjs'
import type { UUID } from '@kode-types/common'
import type { Tool, ToolUseContext } from '@tool'
import type { ToolPermissionContext } from '@kode-types/toolPermissionContext'
import type { CanUseToolFn } from '@kode-types/canUseTool'
import type { NormalizedMessage, FullToolUseResult } from '@utils/messages'

// ============================================================================
// Message Types
// ============================================================================

export type UserMessage = {
  message: MessageParam
  type: 'user'
  uuid: UUID
  toolUseResult?: FullToolUseResult
  options?: {
    isKodingRequest?: boolean
    kodingContext?: string
    isCustomCommand?: boolean
    commandName?: string
    commandArgs?: string
  }
}

export type AssistantMessage = {
  costUSD: number
  durationMs: number
  message: APIAssistantMessage
  type: 'assistant'
  uuid: UUID
  isApiErrorMessage?: boolean
  responseId?: string
}

export type ProgressMessage = {
  content: AssistantMessage
  normalizedMessages: NormalizedMessage[]
  siblingToolUseIDs: Set<string>
  tools: Tool[]
  toolUseID: string
  type: 'progress'
  uuid: UUID
}

export type Message = UserMessage | AssistantMessage | ProgressMessage

export type Response = { costUSD: number; response: string }

// ============================================================================
// Tool Queue Types
// ============================================================================

export type ToolQueueEntry = {
  id: string
  block: ToolUseBlock
  assistantMessage: AssistantMessage
  status: 'queued' | 'executing' | 'completed' | 'yielded'
  isConcurrencySafe: boolean
  pendingProgress: ProgressMessage[]
  queuedProgressEmitted?: boolean
  results?: (UserMessage | AssistantMessage)[]
  contextModifiers?: Array<
    (ctx: ExtendedToolUseContext) => ExtendedToolUseContext
  >
  promise?: Promise<void>
}

export type ToolUseLikeBlock = ToolUseBlock & {
  type: 'tool_use' | 'server_tool_use' | 'mcp_tool_use'
}

// ============================================================================
// Context Types
// ============================================================================

export interface ExtendedToolUseContext extends ToolUseContext {
  abortController: AbortController
  options: {
    commands: any[]
    forkNumber: number
    messageLogName: string
    tools: Tool[]
    mcpClients?: any[]
    verbose: boolean
    safeMode: boolean
    maxThinkingTokens: number
    isKodingRequest?: boolean
    lastUserPrompt?: string
    model?: string | import('@utils/config').ModelPointerType
    toolPermissionContext?: ToolPermissionContext
    shouldAvoidPermissionPrompts?: boolean
    persistSession?: boolean
  }
  readFileTimestamps: { [filename: string]: number }
  requestId?: string
}

// ============================================================================
// Binary Feedback Types
// ============================================================================

export type BinaryFeedbackResult =
  | { message: AssistantMessage | null; shouldSkipPermissionCheck: false }
  | { message: AssistantMessage; shouldSkipPermissionCheck: true }

// ============================================================================
// Hook State Types
// ============================================================================

export type HookState = {
  stopHookActive?: boolean
  stopHookAttempts?: number
  toolRepairAttempts?: number
}

// ============================================================================
// Executor Types
// ============================================================================

export type ToolUseQueueOptions = {
  toolDefinitions: Tool[]
  canUseTool: CanUseToolFn
  toolUseContext: ExtendedToolUseContext
  siblingToolUseIDs: Set<string>
  shouldSkipPermissionCheck?: boolean
}

// ============================================================================
// Type Guards
// ============================================================================

export function isToolUseLikeBlock(block: any): block is ToolUseLikeBlock {
  return (
    block &&
    typeof block === 'object' &&
    (block.type === 'tool_use' ||
      block.type === 'server_tool_use' ||
      block.type === 'mcp_tool_use')
  )
}
