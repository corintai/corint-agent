import type { HookEventName, HookMatcher } from './types'

export type CachedHooks = {
  mtimeMs: number
  byEvent: Partial<Record<HookEventName, HookMatcher[]>>
}

export const settingsHooksCache = new Map<string, CachedHooks>()
export const pluginHooksCache = new Map<string, CachedHooks>()
export const sessionStartCache = new Map<
  string,
  { additionalContext: string }
>()
