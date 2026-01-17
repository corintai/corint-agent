export type DecisionReason =
  | { type: 'rule'; rule: string }
  | { type: 'other'; reason: string }
  | { type: 'subcommandResults'; reasons: Map<string, BashPermissionDecision> }

export type BashPermissionDecision =
  | {
      behavior: 'allow'
      updatedInput: { command: string }
      decisionReason?: DecisionReason
    }
  | {
      behavior: 'deny' | 'ask' | 'passthrough'
      message: string
      decisionReason?: DecisionReason
      blockedPath?: string
      suggestions?: import('@kode-types/toolPermissionContext').ToolPermissionContextUpdate[]
    }

export type BashPermissionResult =
  | { result: true }
  | {
      result: false
      message: string
      shouldPromptUser?: boolean
      suggestions?: import('@kode-types/toolPermissionContext').ToolPermissionContextUpdate[]
    }
