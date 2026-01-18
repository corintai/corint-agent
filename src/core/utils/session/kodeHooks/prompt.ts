import type { HookEventName, PromptHook } from './types'
import { withHookTimeout } from './execution'
import { hookValueForPrompt } from './utils'

function interpolatePromptHookTemplate(
  template: string,
  hookInput: Record<string, unknown>,
): string {
  return String(template ?? '')
    .replaceAll('$TOOL_INPUT', hookValueForPrompt(hookInput.tool_input))
    .replaceAll('$TOOL_RESULT', hookValueForPrompt(hookInput.tool_result))
    .replaceAll('$TOOL_RESPONSE', hookValueForPrompt(hookInput.tool_response))
    .replaceAll('$USER_PROMPT', hookValueForPrompt(hookInput.user_prompt))
    .replaceAll('$PROMPT', hookValueForPrompt(hookInput.prompt))
    .replaceAll('$REASON', hookValueForPrompt(hookInput.reason))
}

function extractAssistantText(message: any): string {
  const content = (message as any)?.message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b: any) => b && typeof b === 'object' && b.type === 'text')
    .map((b: any) => String(b.text ?? ''))
    .join('')
}

export async function runPromptHook(args: {
  hook: PromptHook
  hookEvent: HookEventName
  hookInput: Record<string, unknown>
  safeMode: boolean
  parentSignal?: AbortSignal
  fallbackTimeoutMs: number
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const { signal, cleanup } = withHookTimeout({
    timeoutSeconds: args.hook.timeout,
    parentSignal: args.parentSignal,
    fallbackTimeoutMs: args.fallbackTimeoutMs,
  })

  try {
    const { queryQuick } = await import('@services/llmLazy')

    const systemPrompt = [
      'You are executing a Kode prompt hook.',
      'Return a single JSON object only (no markdown, no prose).',
      `hook_event_name: ${args.hookEvent}`,
      'Valid fields include:',
      '- systemMessage: string',
      '- decision: \"approve\" | \"block\" (Stop/SubagentStop only)',
      '- reason: string (Stop/SubagentStop only)',
      '- hookSpecificOutput.permissionDecision: \"allow\" | \"deny\" | \"ask\" | \"passthrough\" (PreToolUse only)',
      '- hookSpecificOutput.updatedInput: object (PreToolUse only)',
      '- hookSpecificOutput.additionalContext: string (SessionStart/any)',
    ]

    const promptText = interpolatePromptHookTemplate(
      args.hook.prompt,
      args.hookInput,
    )
    const userPrompt = `${promptText}\n\n# Hook input JSON\n${hookValueForPrompt(args.hookInput)}`

    const response = await queryQuick({
      systemPrompt,
      userPrompt,
      signal,
    })

    return { exitCode: 0, stdout: extractAssistantText(response), stderr: '' }
  } catch (err) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: err instanceof Error ? err.message : String(err),
    }
  } finally {
    cleanup()
  }
}
