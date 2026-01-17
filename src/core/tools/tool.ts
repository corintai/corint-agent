import { z } from 'zod'
import type { PermissionMode } from '@kode-types/permissionMode'
import type { ToolPermissionContext } from '@kode-types/toolPermissionContext'
import type { AssistantMessage } from '@query'

export type ToolOverlay =
  | {
      type: 'bash-background'
      onBackground: () => void
    }
  | {
      type: 'custom'
      name: string
      payload: unknown
    }

export interface ToolUseContext {
  messageId: string | undefined
  toolUseId?: string
  agentId?: string
  safeMode?: boolean
  abortController: AbortController
  readFileTimestamps: { [filePath: string]: number }
  ui?: ToolUiBridge
  options?: {
    commands?: any[]
    tools?: any[]
    verbose?: boolean
    slowAndCapableModel?: string
    safeMode?: boolean
    permissionMode?: PermissionMode
    toolPermissionContext?: ToolPermissionContext
    lastUserPrompt?: string
    forkNumber?: number
    messageLogName?: string
    maxThinkingTokens?: any
    model?: string
    commandAllowedTools?: string[]
    isKodingRequest?: boolean
    kodingContext?: string
    isCustomCommand?: boolean
    mcpClients?: any[]
    disableSlashCommands?: boolean
    persistSession?: boolean
    shouldAvoidPermissionPrompts?: boolean
  }
  responseState?: {
    previousResponseId?: string
    conversationId?: string
  }
}

export interface ValidationResult {
  result: boolean
  message?: string
  errorCode?: number
  meta?: any
}

export interface Tool<
  TInput extends z.ZodTypeAny = z.ZodTypeAny,
  TOutput = any,
> {
  name: string
  description?: string | ((input?: z.infer<TInput>) => Promise<string>)
  inputSchema: TInput
  inputJSONSchema?: Record<string, unknown>
  prompt: (options?: { safeMode?: boolean }) => Promise<string>
  userFacingName?: (input?: z.infer<TInput>) => string
  cachedDescription?: string
  isEnabled: () => Promise<boolean>
  isReadOnly: (input?: z.infer<TInput>) => boolean
  isConcurrencySafe: (input?: z.infer<TInput>) => boolean
  needsPermissions: (input?: z.infer<TInput>) => boolean
  requiresUserInteraction?: (input?: z.infer<TInput>) => boolean
  validateInput?: (
    input: z.infer<TInput>,
    context?: ToolUseContext,
  ) => Promise<ValidationResult>
  renderResultForAssistant: (output: TOutput) => string | any[]
  renderToolUseMessage: (
    input: z.infer<TInput>,
    options: { verbose: boolean },
  ) => string | null
  renderToolUseRejectedMessage?: (...args: any[]) => unknown
  renderToolResultMessage?: (
    output: TOutput,
    options: { verbose: boolean },
  ) => unknown
  call: (
    input: z.infer<TInput>,
    context: ToolUseContext,
  ) => AsyncGenerator<
    | {
        type: 'result'
        data: TOutput
        resultForAssistant?: string | any[]
        newMessages?: unknown[]
        contextModifier?: {
          modifyContext: (ctx: ToolUseContext) => ToolUseContext
        }
      }
    | {
        type: 'progress'
        content: any
        normalizedMessages?: any[]
        tools?: any[]
      },
    void,
    unknown
  >
}

export interface ToolPermissionRequest {
  assistantMessage: AssistantMessage
  tool: Tool
  description: string
  input: { [key: string]: unknown }
  commandPrefix: unknown | null
  toolUseContext: ToolUseContext
  suggestions?: unknown
  riskScore: number | null
}

export interface ToolUiBridge {
  showOverlay?: (overlay: ToolOverlay | null) => void
  requestToolPermission?: (
    request: ToolPermissionRequest,
  ) => Promise<boolean>
}

export function getToolDescription(tool: Tool): string {
  if (tool.cachedDescription) {
    return tool.cachedDescription
  }

  if (typeof tool.description === 'string') {
    return tool.description
  }

  return `Tool: ${tool.name}`
}
