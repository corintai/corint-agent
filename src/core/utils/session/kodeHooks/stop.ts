import { logError } from '@utils/log'
import { getCwd } from '@utils/state'
import { getKodeAgentSessionId } from '@utils/protocol/kodeAgentSessionId'
import type { Hook, StopHookOutcome } from './types'
import { matcherMatchesTool } from './matching'
import { loadPluginMatchers, loadSettingsMatchers } from './loaders'
import { runCommandHook, withHookTimeout } from './execution'
import { runPromptHook } from './prompt'
import {
  coerceHookMessage,
  coerceHookPermissionMode,
  normalizeStopDecision,
  tryParseHookJson,
} from './utils'

export async function runStopHooks(args: {
  hookEvent: 'Stop' | 'SubagentStop'
  reason?: string
  agentId?: string
  permissionMode?: unknown
  cwd?: string
  transcriptPath?: string
  safeMode?: boolean
  stopHookActive?: boolean
  signal?: AbortSignal
}): Promise<StopHookOutcome> {
  const projectDir = args.cwd ?? getCwd()
  const matchers = [
    ...loadSettingsMatchers(projectDir, args.hookEvent),
    ...loadPluginMatchers(projectDir, args.hookEvent),
  ]
  if (matchers.length === 0) {
    return {
      decision: 'approve',
      warnings: [],
      systemMessages: [],
      additionalContexts: [],
    }
  }

  const applicable = matchers.filter(m => matcherMatchesTool(m.matcher, '*'))
  if (applicable.length === 0) {
    return {
      decision: 'approve',
      warnings: [],
      systemMessages: [],
      additionalContexts: [],
    }
  }

  const hookInput: Record<string, unknown> = {
    session_id: getKodeAgentSessionId(),
    transcript_path: args.transcriptPath,
    cwd: projectDir,
    hook_event_name: args.hookEvent,
    permission_mode: coerceHookPermissionMode(args.permissionMode),
    reason: args.reason,
    stop_hook_active: args.stopHookActive === true,
    ...(args.hookEvent === 'SubagentStop'
      ? { agent_id: args.agentId, agent_transcript_path: args.transcriptPath }
      : {}),
  }

  const warnings: string[] = []
  const systemMessages: string[] = []
  const additionalContexts: string[] = []

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
            hookEvent: args.hookEvent,
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

    if (result.exitCode === 2) {
      return {
        decision: 'block',
        message: coerceHookMessage(result.stdout, result.stderr),
        warnings,
        systemMessages,
        additionalContexts,
      }
    }

    if (result.exitCode !== 0) {
      warnings.push(coerceHookMessage(result.stdout, result.stderr))
      continue
    }

    const json = tryParseHookJson(result.stdout)
    if (!json) continue

    if (typeof json.systemMessage === 'string' && json.systemMessage.trim()) {
      systemMessages.push(json.systemMessage.trim())
    }

    const additional =
      json.hookSpecificOutput &&
      typeof json.hookSpecificOutput === 'object' &&
      typeof json.hookSpecificOutput.additionalContext === 'string'
        ? String(json.hookSpecificOutput.additionalContext)
        : null
    if (additional && additional.trim()) {
      additionalContexts.push(additional.trim())
    }

    const stopDecision = normalizeStopDecision(json.decision)
    if (stopDecision === 'block') {
      const reason =
        typeof json.reason === 'string' && json.reason.trim()
          ? json.reason.trim()
          : null
      const msg =
        reason ||
        (systemMessages.length > 0
          ? systemMessages.join('\n\n')
          : coerceHookMessage(result.stdout, result.stderr))
      return {
        decision: 'block',
        message: msg,
        warnings,
        systemMessages,
        additionalContexts,
      }
    }
  }

  return { decision: 'approve', warnings, systemMessages, additionalContexts }
}
