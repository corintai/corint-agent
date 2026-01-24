export type AgentSource =
  | 'built-in'
  | 'plugin'
  | 'userSettings'
  | 'projectSettings'
  | 'flagSettings'
  | 'policySettings'

export type AgentLocation = 'built-in' | 'plugin' | 'user' | 'project'

export type AgentModel = 'inherit' | 'haiku' | 'sonnet' | 'opus' | (string & {})

export type AgentPermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'plan'
  | 'bypassPermissions'
  | 'dontAsk'
  | 'delegate'

export interface AgentConfig {
  agentType: string
  whenToUse: string
  tools: string[] | '*'
  disallowedTools?: string[]
  skills?: string[]
  systemPrompt: string
  source: AgentSource
  location: AgentLocation
  baseDir?: string
  filename?: string
  color?: string
  model?: AgentModel
  permissionMode?: AgentPermissionMode
  forkContext?: boolean
}
