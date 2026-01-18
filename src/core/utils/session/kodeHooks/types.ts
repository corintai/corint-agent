export type HookEventName =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Stop'
  | 'SubagentStop'
  | 'UserPromptSubmit'
  | 'SessionStart'
  | 'SessionEnd'

export type CommandHook = {
  type: 'command'
  command: string
  timeout?: number
  pluginRoot?: string
}

export type PromptHook = {
  type: 'prompt'
  prompt: string
  timeout?: number
  pluginRoot?: string
}

export type Hook = CommandHook | PromptHook

export type HookMatcher = {
  matcher: string
  hooks: Hook[]
}

export type HookFileEnvelope = {
  description?: unknown
  hooks?: unknown
  [key: string]: unknown
}

export type HooksSettings = Partial<Record<HookEventName, HookMatcher[]>> & {
  [key: string]: unknown
}

export type SettingsFileWithHooks = {
  hooks?: HooksSettings
  [key: string]: unknown
}

export type PreToolUseHookOutcome =
  | {
      kind: 'allow'
      warnings: string[]
      permissionDecision?: 'allow' | 'ask'
      updatedInput?: Record<string, unknown>
      systemMessages?: string[]
      additionalContexts?: string[]
    }
  | {
      kind: 'block'
      message: string
      systemMessages?: string[]
      additionalContexts?: string[]
    }

export type StopHookOutcome =
  | {
      decision: 'approve'
      warnings: string[]
      systemMessages: string[]
      additionalContexts: string[]
    }
  | {
      decision: 'block'
      message: string
      warnings: string[]
      systemMessages: string[]
      additionalContexts: string[]
    }

export type UserPromptHookOutcome =
  | {
      decision: 'allow'
      warnings: string[]
      systemMessages: string[]
      additionalContexts: string[]
    }
  | {
      decision: 'block'
      message: string
      warnings: string[]
      systemMessages: string[]
      additionalContexts: string[]
    }
