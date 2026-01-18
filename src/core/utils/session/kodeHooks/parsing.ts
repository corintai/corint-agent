import type {
  CommandHook,
  Hook,
  HookEventName,
  HookMatcher,
  PromptHook,
} from './types'

function isCommandHook(value: unknown): value is CommandHook {
  return (
    value !== null &&
    typeof value === 'object' &&
    (value as any).type === 'command' &&
    typeof (value as any).command === 'string' &&
    Boolean((value as any).command.trim())
  )
}

function isPromptHook(value: unknown): value is PromptHook {
  return (
    value !== null &&
    typeof value === 'object' &&
    (value as any).type === 'prompt' &&
    typeof (value as any).prompt === 'string' &&
    Boolean((value as any).prompt.trim())
  )
}

export function isHook(value: unknown): value is Hook {
  return isCommandHook(value) || isPromptHook(value)
}

export function parseHookMatchers(value: unknown): HookMatcher[] {
  if (!Array.isArray(value)) return []

  const out: HookMatcher[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const matcher =
      typeof (item as any).matcher === 'string'
        ? (item as any).matcher.trim()
        : ''
    const effectiveMatcher = matcher || '*'
    const hooksRaw = (item as any).hooks
    const hooks = Array.isArray(hooksRaw) ? hooksRaw.filter(isHook) : []
    if (hooks.length === 0) continue
    out.push({ matcher: effectiveMatcher, hooks })
  }
  return out
}

export function parseHooksByEvent(
  rawHooks: unknown,
): Partial<Record<HookEventName, HookMatcher[]>> {
  if (!rawHooks || typeof rawHooks !== 'object') return {}
  const hooks: any = rawHooks
  return {
    PreToolUse: parseHookMatchers(hooks.PreToolUse),
    PostToolUse: parseHookMatchers(hooks.PostToolUse),
    Stop: parseHookMatchers(hooks.Stop),
    SubagentStop: parseHookMatchers(hooks.SubagentStop),
    UserPromptSubmit: parseHookMatchers(hooks.UserPromptSubmit),
    SessionStart: parseHookMatchers(hooks.SessionStart),
    SessionEnd: parseHookMatchers(hooks.SessionEnd),
  }
}

export function parseSessionStartHooks(value: unknown): CommandHook[] {
  if (!Array.isArray(value)) return []
  const out: CommandHook[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const hooksRaw = (item as any).hooks
    const hooks = Array.isArray(hooksRaw) ? hooksRaw.filter(isCommandHook) : []
    out.push(...hooks)
  }
  return out
}
