import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getCwd } from '@utils/state'
import { getKodeAgentSessionId } from '@utils/protocol/kodeAgentSessionId'
import { getSessionPlugins } from '@utils/session/sessionPlugins'
import {
  ensureSessionTempDirExists,
  getSessionTempDir,
} from '@utils/session/sessionTempDir'
import type { HookFileEnvelope } from './types'
import { sessionStartCache } from './state'
import { parseSessionStartHooks } from './parsing'
import { runCommandHook } from './execution'
import { applyEnvFileToProcessEnv } from './env'
import {
  coerceHookPermissionMode,
  parseSessionStartAdditionalContext,
} from './utils'

export async function getSessionStartAdditionalContext(args?: {
  permissionMode?: unknown
  cwd?: string
  signal?: AbortSignal
}): Promise<string> {
  const sessionId = getKodeAgentSessionId()
  const cached = sessionStartCache.get(sessionId)
  if (cached) return cached.additionalContext

  const projectDir = args?.cwd ?? getCwd()
  const plugins = getSessionPlugins()
  if (plugins.length === 0) {
    sessionStartCache.set(sessionId, { additionalContext: '' })
    return ''
  }

  ensureSessionTempDirExists()
  const envFileDir = mkdtempSync(join(getSessionTempDir(), 'kode-env-'))
  const envFilePath = join(envFileDir, `${sessionId}.env`)
  try {
    writeFileSync(envFilePath, '', 'utf8')
  } catch {}

  const additionalContexts: string[] = []

  try {
    for (const plugin of plugins) {
      for (const hookPath of plugin.hooksFiles ?? []) {
        let hookObj: any
        try {
          const raw = readFileSync(hookPath, 'utf8')
          const parsed = JSON.parse(raw) as HookFileEnvelope
          hookObj =
            parsed && typeof parsed === 'object' && parsed.hooks
              ? parsed.hooks
              : parsed
        } catch {
          continue
        }

        const hooks = parseSessionStartHooks(hookObj?.SessionStart).map(h => ({
          ...h,
          pluginRoot: plugin.rootDir,
        }))
        if (hooks.length === 0) continue

        for (const hook of hooks) {
          const payload = {
            session_id: sessionId,
            cwd: projectDir,
            hook_event_name: 'SessionStart',
            permission_mode: coerceHookPermissionMode(args?.permissionMode),
          }

          const result = await runCommandHook({
            command: hook.command,
            stdinJson: payload,
            cwd: projectDir,
            env: {
              CLAUDE_PROJECT_DIR: projectDir,
              ...(hook.pluginRoot
                ? { CLAUDE_PLUGIN_ROOT: hook.pluginRoot }
                : {}),
              CLAUDE_ENV_FILE: envFilePath,
            },
            signal: args?.signal,
          })

          if (result.exitCode !== 0) continue
          const injected = parseSessionStartAdditionalContext(result.stdout)
          if (injected) additionalContexts.push(injected)
        }
      }

      const inlineHooks = (plugin.manifest as any)?.hooks
      if (
        inlineHooks &&
        typeof inlineHooks === 'object' &&
        !Array.isArray(inlineHooks)
      ) {
        const hookObj =
          (inlineHooks as any).hooks &&
          typeof (inlineHooks as any).hooks === 'object' &&
          !Array.isArray((inlineHooks as any).hooks)
            ? (inlineHooks as any).hooks
            : inlineHooks

        const hooks = parseSessionStartHooks(
          (hookObj as any)?.SessionStart,
        ).map(h => ({
          ...h,
          pluginRoot: plugin.rootDir,
        }))
        if (hooks.length > 0) {
          for (const hook of hooks) {
            const payload = {
              session_id: sessionId,
              cwd: projectDir,
              hook_event_name: 'SessionStart',
              permission_mode: coerceHookPermissionMode(args?.permissionMode),
            }

            const result = await runCommandHook({
              command: hook.command,
              stdinJson: payload,
              cwd: projectDir,
              env: {
                CLAUDE_PROJECT_DIR: projectDir,
                ...(hook.pluginRoot
                  ? { CLAUDE_PLUGIN_ROOT: hook.pluginRoot }
                  : {}),
                CLAUDE_ENV_FILE: envFilePath,
              },
              signal: args?.signal,
            })

            if (result.exitCode !== 0) continue
            const injected = parseSessionStartAdditionalContext(result.stdout)
            if (injected) additionalContexts.push(injected)
          }
        }
      }
    }
  } finally {
    applyEnvFileToProcessEnv(envFilePath)
    try {
      rmSync(envFileDir, { recursive: true, force: true })
    } catch {}
  }

  const additionalContext = additionalContexts.filter(Boolean).join('\n\n')
  sessionStartCache.set(sessionId, { additionalContext })
  return additionalContext
}
