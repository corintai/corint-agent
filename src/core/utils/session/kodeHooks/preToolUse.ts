import { logError } from '@utils/log'
import { getCwd } from '@utils/state'
import { getKodeAgentSessionId } from '@utils/protocol/kodeAgentSessionId'
import type { Hook, PreToolUseHookOutcome } from './types'
import { matcherMatchesTool } from './matching'
import { loadPluginMatchers, loadSettingsMatchers } from './loaders'
import { runCommandHook, withHookTimeout } from './execution'
import { runPromptHook } from './prompt'
import {
  coerceHookMessage,
  coerceHookPermissionMode,
  normalizePermissionDecision,
  tryParseHookJson,
} from './utils'

export async function runPreToolUseHooks(args: {
  toolName: string
  toolInput: Record<string, unknown>
  toolUseId: string
  permissionMode?: unknown
  cwd?: string
  transcriptPath?: string
  safeMode?: boolean
  signal?: AbortSignal
}): Promise<PreToolUseHookOutcome> {
  const projectDir = args.cwd ?? getCwd()
  const matchers = [
    ...loadSettingsMatchers(projectDir, 'PreToolUse'),
    ...loadPluginMatchers(projectDir, 'PreToolUse'),
  ]
  if (matchers.length === 0) return { kind: 'allow', warnings: [] }

  const applicable = matchers.filter(m =>
    matcherMatchesTool(m.matcher, args.toolName),
  )
  if (applicable.length === 0) return { kind: 'allow', warnings: [] }

  const hookInput: Record<string, unknown> = {
    session_id: getKodeAgentSessionId(),
    transcript_path: args.transcriptPath,
    cwd: projectDir,
    hook_event_name: 'PreToolUse',
    permission_mode: coerceHookPermissionMode(args.permissionMode),
    tool_name: args.toolName,
    tool_input: args.toolInput,
    tool_use_id: args.toolUseId,
  }

  const warnings: string[] = []
  const systemMessages: string[] = []
  const additionalContexts: string[] = []

  let mergedUpdatedInput: Record<string, unknown> | undefined
  let permissionDecision: 'allow' | 'ask' | null = null

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
            hookEvent: 'PreToolUse',
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

    const { hook, result } = item.value

    if (result.exitCode === 2) {
      return {
        kind: 'block',
        message: coerceHookMessage(result.stdout, result.stderr),
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

    const decision = normalizePermissionDecision(
      json.hookSpecificOutput?.permissionDecision,
    )
    if (decision === 'deny') {
      const msg =
        systemMessages.length > 0
          ? systemMessages.join('\n\n')
          : coerceHookMessage(result.stdout, result.stderr)
      return {
        kind: 'block',
        message: msg,
        systemMessages,
        additionalContexts,
      }
    }

    if (decision === 'ask') {
      permissionDecision = 'ask'
    } else if (decision === 'allow') {
      if (!permissionDecision) permissionDecision = 'allow'
    }

    const updated =
      json.hookSpecificOutput &&
      typeof json.hookSpecificOutput === 'object' &&
      json.hookSpecificOutput.updatedInput &&
      typeof json.hookSpecificOutput.updatedInput === 'object'
        ? (json.hookSpecificOutput.updatedInput as Record<string, unknown>)
        : null
    if (updated) {
      mergedUpdatedInput = { ...(mergedUpdatedInput ?? {}), ...updated }
    }
  }

  return {
    kind: 'allow',
    warnings,
    permissionDecision:
      permissionDecision === 'allow'
        ? 'allow'
        : permissionDecision === 'ask'
          ? 'ask'
          : undefined,
    updatedInput:
      permissionDecision === 'allow' ? mergedUpdatedInput : undefined,
    systemMessages,
    additionalContexts,
  }
}
