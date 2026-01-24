export function splitCliList(values: string[]): string[] {
  const out: string[] = []

  for (const value of values) {
    let current = ''
    let inParens = false

    for (const ch of value) {
      switch (ch) {
        case '(':
          inParens = true
          current += ch
          break
        case ')':
          inParens = false
          current += ch
          break
        case ',':
          if (inParens) {
            current += ch
          } else {
            const trimmed = current.trim()
            if (trimmed) out.push(trimmed)
            current = ''
          }
          break
        case ' ':
          if (inParens) {
            current += ch
          } else {
            const trimmed = current.trim()
            if (trimmed) out.push(trimmed)
            current = ''
          }
          break
        default:
          current += ch
      }
    }

    const trimmed = current.trim()
    if (trimmed) out.push(trimmed)
  }

  return out
}

export function normalizeToolList(value: unknown): string[] | null {
  if (value === undefined || value === null) return null
  if (!value) return []

  let raw: string[] = []
  if (typeof value === 'string') raw = [value]
  else if (Array.isArray(value))
    raw = value.filter((v): v is string => typeof v === 'string')

  if (raw.length === 0) return []
  const parsed = splitCliList(raw)
  if (parsed.includes('*')) return ['*']
  return parsed
}

export function z2A(value: unknown): string[] | undefined {
  const normalized = normalizeToolList(value)
  if (normalized === null) return value === undefined ? undefined : []
  if (normalized.includes('*')) return undefined
  return normalized
}

export function qP(value: unknown): string[] {
  const normalized = normalizeToolList(value)
  if (normalized === null) return []
  return normalized
}
