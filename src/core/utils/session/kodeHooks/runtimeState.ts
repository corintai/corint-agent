import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getKodeAgentSessionId } from '@utils/protocol/kodeAgentSessionId'
import { getSessionOutputDir } from '@utils/session/sessionTempDir'
import { hookValueForPrompt } from './utils'

type HookRuntimeState = {
  transcriptPath?: string
  queuedSystemMessages: string[]
  queuedAdditionalContexts: string[]
}

const HOOK_RUNTIME_STATE_KEY = '__kodeHookRuntimeState'

function getHookRuntimeState(toolUseContext: any): HookRuntimeState {
  const existing = toolUseContext?.[HOOK_RUNTIME_STATE_KEY]
  if (
    existing &&
    typeof existing === 'object' &&
    Array.isArray((existing as any).queuedSystemMessages) &&
    Array.isArray((existing as any).queuedAdditionalContexts)
  ) {
    return existing as HookRuntimeState
  }
  const created: HookRuntimeState = {
    transcriptPath: undefined,
    queuedSystemMessages: [],
    queuedAdditionalContexts: [],
  }
  if (toolUseContext && typeof toolUseContext === 'object') {
    ;(toolUseContext as any)[HOOK_RUNTIME_STATE_KEY] = created
  }
  return created
}

export function updateHookTranscriptForMessages(
  toolUseContext: any,
  messages: any[],
): void {
  const state = getHookRuntimeState(toolUseContext)
  const sessionId = getKodeAgentSessionId()

  const dir = join(getSessionOutputDir(), 'kode-hooks-transcripts')
  try {
    mkdirSync(dir, { recursive: true })
  } catch {}

  if (!state.transcriptPath) {
    state.transcriptPath = join(dir, `${sessionId}.transcript.txt`)
  }

  const lines: string[] = []
  for (const msg of Array.isArray(messages) ? messages : []) {
    if (!msg || typeof msg !== 'object') continue
    if (msg.type !== 'user' && msg.type !== 'assistant') continue

    if (msg.type === 'user') {
      const content = (msg as any)?.message?.content
      if (typeof content === 'string') {
        lines.push(`user: ${content}`)
        continue
      }
      if (Array.isArray(content)) {
        const parts: string[] = []
        for (const block of content) {
          if (!block || typeof block !== 'object') continue
          if (block.type === 'text') parts.push(String(block.text ?? ''))
          if (block.type === 'tool_result')
            parts.push(`[tool_result] ${String(block.content ?? '')}`)
        }
        lines.push(`user: ${parts.join('')}`)
      }
      continue
    }

    const content = (msg as any)?.message?.content
    if (typeof content === 'string') {
      lines.push(`assistant: ${content}`)
      continue
    }
    if (!Array.isArray(content)) continue

    const parts: string[] = []
    for (const block of content) {
      if (!block || typeof block !== 'object') continue
      if (block.type === 'text') parts.push(String(block.text ?? ''))
      if (block.type === 'tool_use' || block.type === 'server_tool_use') {
        parts.push(
          `[tool_use:${String(block.name ?? '')}] ${hookValueForPrompt(block.input)}`,
        )
      }
      if (block.type === 'mcp_tool_use') {
        parts.push(
          `[mcp_tool_use:${String(block.name ?? '')}] ${hookValueForPrompt(block.input)}`,
        )
      }
    }
    lines.push(`assistant: ${parts.join('')}`)
  }

  try {
    writeFileSync(state.transcriptPath, lines.join('\n') + '\n', 'utf8')
  } catch {}
}

export function drainHookSystemPromptAdditions(toolUseContext: any): string[] {
  const state = getHookRuntimeState(toolUseContext)
  const systemMessages = state.queuedSystemMessages.splice(
    0,
    state.queuedSystemMessages.length,
  )
  const contexts = state.queuedAdditionalContexts.splice(
    0,
    state.queuedAdditionalContexts.length,
  )

  const additions: string[] = []
  if (systemMessages.length > 0) {
    additions.push(
      ['\n# Hook system messages', ...systemMessages.map(m => m.trim())]
        .filter(Boolean)
        .join('\n\n'),
    )
  }
  if (contexts.length > 0) {
    additions.push(
      ['\n# Hook additional context', ...contexts.map(m => m.trim())]
        .filter(Boolean)
        .join('\n\n'),
    )
  }
  return additions
}

export function getHookTranscriptPath(toolUseContext: any): string | undefined {
  return getHookRuntimeState(toolUseContext).transcriptPath
}

export function queueHookSystemMessages(
  toolUseContext: any,
  messages: string[],
): void {
  const state = getHookRuntimeState(toolUseContext)
  for (const msg of messages) {
    const trimmed = String(msg ?? '').trim()
    if (trimmed) state.queuedSystemMessages.push(trimmed)
  }
}

export function queueHookAdditionalContexts(
  toolUseContext: any,
  contexts: string[],
): void {
  const state = getHookRuntimeState(toolUseContext)
  for (const ctx of contexts) {
    const trimmed = String(ctx ?? '').trim()
    if (trimmed) state.queuedAdditionalContexts.push(trimmed)
  }
}
