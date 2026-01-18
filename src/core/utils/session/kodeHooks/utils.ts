export function coerceHookMessage(stdout: string, stderr: string): string {
  const s = (stderr || '').trim()
  if (s) return s
  const o = (stdout || '').trim()
  if (o) return o
  return 'Hook blocked the tool call.'
}

export function coerceHookPermissionMode(mode: unknown): 'ask' | 'allow' {
  if (mode === 'acceptEdits' || mode === 'bypassPermissions') return 'allow'
  return 'ask'
}

export function extractFirstJsonObject(text: string): string | null {
  let start = -1
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (start === -1) {
      if (ch === '{') {
        start = i
        depth = 1
      }
      continue
    }

    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === '\\') {
        escaped = true
        continue
      }
      if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }

    if (ch === '{') {
      depth++
      continue
    }
    if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }

  return null
}

export function parseSessionStartAdditionalContext(
  stdout: string,
): string | null {
  const trimmed = String(stdout ?? '').trim()
  if (!trimmed) return null

  const jsonStr = extractFirstJsonObject(trimmed) ?? trimmed
  try {
    const parsed = JSON.parse(jsonStr)
    const additional =
      parsed &&
      typeof parsed === 'object' &&
      (parsed as any).hookSpecificOutput &&
      typeof (parsed as any).hookSpecificOutput.additionalContext === 'string'
        ? String((parsed as any).hookSpecificOutput.additionalContext)
        : null
    return additional && additional.trim() ? additional : null
  } catch {
    return null
  }
}

export function tryParseHookJson(stdout: string): any | null {
  const trimmed = String(stdout ?? '').trim()
  if (!trimmed) return null
  const jsonStr = extractFirstJsonObject(trimmed) ?? trimmed
  try {
    const parsed = JSON.parse(jsonStr)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

export function normalizePermissionDecision(
  value: unknown,
): 'allow' | 'deny' | 'ask' | 'passthrough' | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (normalized === 'allow' || normalized === 'approve') return 'allow'
  if (normalized === 'deny' || normalized === 'block') return 'deny'
  if (normalized === 'ask') return 'ask'
  if (normalized === 'passthrough' || normalized === 'continue')
    return 'passthrough'
  return null
}

export function normalizeStopDecision(
  value: unknown,
): 'approve' | 'block' | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (normalized === 'approve' || normalized === 'allow') return 'approve'
  if (normalized === 'block' || normalized === 'deny') return 'block'
  return null
}

export function hookValueForPrompt(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
