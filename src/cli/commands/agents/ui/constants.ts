export const DEFAULT_AGENT_MODEL = 'sonnet'
export const COLOR_OPTIONS = [
  'automatic',
  'red',
  'blue',
  'green',
  'yellow',
  'purple',
  'orange',
  'pink',
  'cyan',
] as const

export type AgentColor = (typeof COLOR_OPTIONS)[number]
