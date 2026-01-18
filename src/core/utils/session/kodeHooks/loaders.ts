import { readFileSync, statSync } from 'fs'
import { logError } from '@utils/log'
import { loadSettingsWithLegacyFallback } from '@utils/config/settingsFiles'
import { getSessionPlugins } from '@utils/session/sessionPlugins'
import type {
  HookEventName,
  HookFileEnvelope,
  HookMatcher,
  SettingsFileWithHooks,
} from './types'
import { parseHooksByEvent } from './parsing'
import { pluginHooksCache, settingsHooksCache } from './state'

function loadInlinePluginHooksByEvent(plugin: {
  manifestPath: string
  manifest: unknown
}): Partial<Record<HookEventName, HookMatcher[]>> | null {
  const manifestHooks = (plugin.manifest as any)?.hooks
  if (
    !manifestHooks ||
    typeof manifestHooks !== 'object' ||
    Array.isArray(manifestHooks)
  )
    return null

  const hookObj =
    (manifestHooks as any).hooks &&
    typeof (manifestHooks as any).hooks === 'object' &&
    !Array.isArray((manifestHooks as any).hooks)
      ? (manifestHooks as any).hooks
      : manifestHooks

  const cacheKey = `${plugin.manifestPath}#inlineHooks`
  try {
    const stat = statSync(plugin.manifestPath)
    const cached = pluginHooksCache.get(cacheKey)
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.byEvent

    const byEvent = parseHooksByEvent(hookObj)
    pluginHooksCache.set(cacheKey, { mtimeMs: stat.mtimeMs, byEvent })
    return byEvent
  } catch (err) {
    logError(err)
    pluginHooksCache.delete(cacheKey)
    return null
  }
}

function loadPreToolUseMatchers(projectDir: string): HookMatcher[] {
  const loaded = loadSettingsWithLegacyFallback({
    destination: 'projectSettings',
    projectDir,
    migrateToPrimary: true,
  })
  const settingsPath = loaded.usedPath
  if (!settingsPath) return []
  try {
    const stat = statSync(settingsPath)
    const cached = settingsHooksCache.get(settingsPath)
    if (cached && cached.mtimeMs === stat.mtimeMs)
      return cached.byEvent.PreToolUse ?? []

    const parsed = loaded.settings as SettingsFileWithHooks | null
    const byEvent = parseHooksByEvent(parsed?.hooks)
    settingsHooksCache.set(settingsPath, { mtimeMs: stat.mtimeMs, byEvent })
    return byEvent.PreToolUse ?? []
  } catch {
    settingsHooksCache.delete(settingsPath)
    return []
  }
}

export function loadSettingsMatchers(
  projectDir: string,
  event: HookEventName,
): HookMatcher[] {
  const loaded = loadSettingsWithLegacyFallback({
    destination: 'projectSettings',
    projectDir,
    migrateToPrimary: true,
  })
  const settingsPath = loaded.usedPath
  if (!settingsPath) return []
  try {
    const stat = statSync(settingsPath)
    const cached = settingsHooksCache.get(settingsPath)
    if (cached && cached.mtimeMs === stat.mtimeMs)
      return cached.byEvent[event] ?? []

    const parsed = loaded.settings as SettingsFileWithHooks | null
    const byEvent = parseHooksByEvent(parsed?.hooks)
    settingsHooksCache.set(settingsPath, { mtimeMs: stat.mtimeMs, byEvent })
    return byEvent[event] ?? []
  } catch {
    settingsHooksCache.delete(settingsPath)
    return []
  }
}

function loadPluginPreToolUseMatchers(projectDir: string): HookMatcher[] {
  const plugins = getSessionPlugins()
  if (plugins.length === 0) return []

  const out: HookMatcher[] = []
  for (const plugin of plugins) {
    for (const hookPath of plugin.hooksFiles ?? []) {
      try {
        const stat = statSync(hookPath)
        const cached = pluginHooksCache.get(hookPath)
        if (cached && cached.mtimeMs === stat.mtimeMs) {
          out.push(
            ...(cached.byEvent.PreToolUse ?? []).map(m => ({
              matcher: m.matcher,
              hooks: m.hooks.map(h => ({ ...h, pluginRoot: plugin.rootDir })),
            })),
          )
          continue
        }

        const raw = readFileSync(hookPath, 'utf8')
        const parsed = JSON.parse(raw) as HookFileEnvelope
        const hookObj =
          parsed && typeof parsed === 'object' && parsed.hooks
            ? parsed.hooks
            : parsed
        const byEvent = parseHooksByEvent(hookObj)
        pluginHooksCache.set(hookPath, { mtimeMs: stat.mtimeMs, byEvent })
        out.push(
          ...(byEvent.PreToolUse ?? []).map(m => ({
            matcher: m.matcher,
            hooks: m.hooks.map(h => ({ ...h, pluginRoot: plugin.rootDir })),
          })),
        )
      } catch (err) {
        logError(err)
        continue
      }
    }

    const inlineByEvent = loadInlinePluginHooksByEvent(plugin)
    if (inlineByEvent?.PreToolUse) {
      out.push(
        ...inlineByEvent.PreToolUse.map(m => ({
          matcher: m.matcher,
          hooks: m.hooks.map(h => ({ ...h, pluginRoot: plugin.rootDir })),
        })),
      )
    }
  }

  return out
}

export function loadPluginMatchers(
  projectDir: string,
  event: HookEventName,
): HookMatcher[] {
  const plugins = getSessionPlugins()
  if (plugins.length === 0) return []

  const out: HookMatcher[] = []
  for (const plugin of plugins) {
    for (const hookPath of plugin.hooksFiles ?? []) {
      try {
        const stat = statSync(hookPath)
        const cached = pluginHooksCache.get(hookPath)
        if (cached && cached.mtimeMs === stat.mtimeMs) {
          out.push(
            ...(cached.byEvent[event] ?? []).map(m => ({
              matcher: m.matcher,
              hooks: m.hooks.map(h => ({ ...h, pluginRoot: plugin.rootDir })),
            })),
          )
          continue
        }

        const raw = readFileSync(hookPath, 'utf8')
        const parsed = JSON.parse(raw) as HookFileEnvelope
        const hookObj =
          parsed && typeof parsed === 'object' && parsed.hooks
            ? parsed.hooks
            : parsed
        const byEvent = parseHooksByEvent(hookObj)
        pluginHooksCache.set(hookPath, { mtimeMs: stat.mtimeMs, byEvent })
        out.push(
          ...(byEvent[event] ?? []).map(m => ({
            matcher: m.matcher,
            hooks: m.hooks.map(h => ({ ...h, pluginRoot: plugin.rootDir })),
          })),
        )
      } catch (err) {
        logError(err)
        continue
      }
    }

    const inlineByEvent = loadInlinePluginHooksByEvent(plugin)
    if (inlineByEvent?.[event]) {
      out.push(
        ...(inlineByEvent[event] ?? []).map(m => ({
          matcher: m.matcher,
          hooks: m.hooks.map(h => ({ ...h, pluginRoot: plugin.rootDir })),
        })),
      )
    }
  }
  return out
}
