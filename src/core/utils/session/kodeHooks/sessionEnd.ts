import { logError } from '@utils/log'
import { getCwd } from '@utils/state'
import { getKodeAgentSessionId } from '@utils/protocol/kodeAgentSessionId'
import type { Hook } from './types'
import { matcherMatchesTool } from './matching'
import { loadPluginMatchers, loadSettingsMatchers } from './loaders'
import { runCommandHook, withHookTimeout } from './execution'
import { runPromptHook } from './prompt'
import { coerceHookMessage, coerceHookPermissionMode, tryParseHookJson } from './utils'

export async function runSessionEndHooks(args: {
  reason: string
  permissionMode?: unknown
  cwd?: string
  transcriptPath?: string
  safeMode?: boolean
  signal?: AbortSignal
}): Promise<{ warnings: string[]; systemMessages: string[] }> {
  const projectDir = args.cwd ?? getCwd()
  const matchers = [
    ...loadSettingsMatchers(projectDir, 'SessionEnd'),
    ...loadPluginMatchers(projectDir, 'SessionEnd'),
  ]
  if (matchers.length === 0) return { warnings: [], systemMessages: [] }

  const applicable = matchers.filter(m => matcherMatchesTool(m.matcher, '*'))
  if (applicable.length === 0) return { warnings: [], systemMessages: [] }

  const hookInput: Record<string, unknown> = {
    session_id: getKodeAgentSessionId(),
    transcript_path: args.transcriptPath,
    cwd: projectDir,
    hook_event_name: 'SessionEnd',
    permission_mode: coerceHookPermissionMode(args.permissionMode),
    reason: args.reason,
  }

  const warnings: string[] = []
  const systemMessages: string[] = []

  const executions: Array<
    Promise<{
      hook: Hook
      result: { exitCode: number; stdout: string; stderr: string }
    }>
  > = []

  for (const entry of applicable) {
    for (const hook of entry.hooks) {
      if (hook.type === 'prompt') {
        executions.push(
          runPromptHook({
            hook,
            hookEvent: 'SessionEnd',
            hookInput,
            safeMode: args.safeMode ?? false,
            parentSignal: args.signal,
            fallbackTimeoutMs: 30_000,
          }).then(result => ({ hook, result })),
        )
        continue
      }

      const { signal, cleanup } = withHookTimeout({
        timeoutSeconds: hook.timeout,
        parentSignal: args.signal,
        fallbackTimeoutMs: 60_000,
      })
      executions.push(
        runCommandHook({
          command: hook.command,
          stdinJson: hookInput,
          cwd: projectDir,
          env: {
            CLAUDE_PROJECT_DIR: projectDir,
            ...(hook.pluginRoot ? { CLAUDE_PLUGIN_ROOT: hook.pluginRoot } : {}),
          },
          signal,
        })
          .then(result => ({ hook, result }))
          .finally(cleanup),
      )
    }
  }

  const settled = await Promise.allSettled(executions)
  for (const item of settled) {
    if (item.status === 'rejected') {
      logError(item.reason)
      warnings.push(`Hook failed to run: ${String(item.reason ?? '')}`)
      continue
    }

    const { result } = item.value
    if (result.exitCode !== 0) {
      warnings.push(coerceHookMessage(result.stdout, result.stderr))
      continue
    }

    const json = tryParseHookJson(result.stdout)
    if (!json) continue
    if (typeof json.systemMessage === 'string' && json.systemMessage.trim()) {
      systemMessages.push(json.systemMessage.trim())
    }
  }

  return { warnings, systemMessages }
}
