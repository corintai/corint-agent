import { parse, quote, type ParseEntry } from 'shell-quote'

const SINGLE_QUOTE = '__SINGLE_QUOTE__'
const DOUBLE_QUOTE = '__DOUBLE_QUOTE__'
const NEW_LINE = '__NEW_LINE__'

export const SAFE_SHELL_SEPARATORS = new Set(['&&', '||', ';', '|', ';;'])

type ParsedShellTokens =
  | { success: true; tokens: ParseEntry[] }
  | { success: false; error: string }

export function parseShellTokens(
  command: string,
  options?: { preserveNewlines?: boolean },
): ParsedShellTokens {
  try {
    const input = options?.preserveNewlines
      ? command
          .replaceAll('"', `"${DOUBLE_QUOTE}`)
          .replaceAll("'", `'${SINGLE_QUOTE}`)
          .replaceAll('\n', `\n${NEW_LINE}\n`)
      : command
          .replaceAll('"', `"${DOUBLE_QUOTE}`)
          .replaceAll("'", `'${SINGLE_QUOTE}`)

    return {
      success: true,
      tokens: parse(input, varName => `$${varName}`),
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function restoreShellStringToken(token: string): string {
  return token.replaceAll(SINGLE_QUOTE, "'").replaceAll(DOUBLE_QUOTE, '"')
}

function tokensToParts(
  tokens: ParseEntry[],
  options?: { preserveNewlines?: boolean },
): Array<string | null> {
  const collapsed: Array<ParseEntry | null> = []

  for (const token of tokens) {
    if (typeof token === 'string') {
      const restored = restoreShellStringToken(token)
      if (options?.preserveNewlines && restored === NEW_LINE) {
        collapsed.push(null)
        continue
      }

      if (
        collapsed.length > 0 &&
        typeof collapsed[collapsed.length - 1] === 'string'
      ) {
        collapsed[collapsed.length - 1] =
          `${collapsed[collapsed.length - 1]} ${restored}`
        continue
      }
      collapsed.push(restored)
      continue
    }

    if (
      token &&
      typeof token === 'object' &&
      'op' in token &&
      token.op === 'glob' &&
      'pattern' in token
    ) {
      const pattern = String((token as any).pattern)
      if (
        collapsed.length > 0 &&
        typeof collapsed[collapsed.length - 1] === 'string'
      ) {
        collapsed[collapsed.length - 1] =
          `${collapsed[collapsed.length - 1]} ${pattern}`
        continue
      }
      collapsed.push(pattern)
      continue
    }

    collapsed.push(token)
  }

  return collapsed
    .map(entry => {
      if (entry === null) return null
      if (typeof entry === 'string') return entry
      if (!entry || typeof entry !== 'object') return null
      if ('comment' in entry) return `#${(entry as any).comment ?? ''}`
      if ('op' in entry) return String((entry as any).op)
      return null
    })
    .filter((p): p is string | null => p !== undefined)
}

export function splitBashCommandIntoSubcommands(command: string): string[] {
  const parsed = parseShellTokens(command, { preserveNewlines: true })
  if ('error' in parsed) throw new Error(parsed.error)

  const out: string[] = []
  let currentTokens: ParseEntry[] = []

  const flush = () => {
    const rebuilt = rebuildCommandFromTokens(currentTokens, '').trim()
    if (rebuilt) out.push(rebuilt)
    currentTokens = []
  }

  for (const token of parsed.tokens) {
    if (typeof token === 'string') {
      const restored = restoreShellStringToken(token)
      if (restored === NEW_LINE) {
        flush()
        continue
      }
    }
    if (token && typeof token === 'object' && 'op' in token) {
      const op = String((token as any).op)
      if (SAFE_SHELL_SEPARATORS.has(op)) {
        flush()
        continue
      }
    }
    currentTokens.push(token)
  }
  flush()
  return out
}

export function isOpToken(entry: unknown, op: string): entry is { op: string } {
  return (
    !!entry &&
    typeof entry === 'object' &&
    'op' in (entry as any) &&
    (entry as any).op === op
  )
}

export function isSafeFd(value: string): boolean {
  const v = value.trim()
  return v === '0' || v === '1' || v === '2'
}

export function isSimplePathToken(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const v = value.trim()
  if (!v) return false
  if (/^\d+$/.test(v)) return false
  if (v.includes('$')) return false
  if (v.includes('`')) return false
  if (v.includes('*') || v.includes('?') || v.includes('[')) return false
  return true
}

function hasUnescapedVarSuffixToken(
  token: unknown,
  tokens: ParseEntry[],
  index: number,
): boolean {
  if (typeof token !== 'string') return false
  const t = token
  if (t === '$') return true
  if (!t.endsWith('$')) return false

  if (t.includes('=') && t.endsWith('=$')) return true

  let depth = 1
  for (let i = index + 1; i < tokens.length && depth > 0; i++) {
    const next = tokens[i]
    if (isOpToken(next, '(')) depth++
    if (isOpToken(next, ')') && --depth === 0) {
      const after = tokens[i + 1]
      return typeof after === 'string' && !after.startsWith(' ')
    }
  }
  return false
}

function isWeirdTokenNeedingQuotes(value: string): boolean {
  if (/^\d+>>?$/.test(value)) return false
  if (value.includes(' ') || value.includes('\t')) return true
  if (value.length === 1 && '><|&;()'.includes(value)) return true
  return false
}

function joinTokensWithMinimalSpacing(
  out: string,
  next: string,
  noSpace: boolean,
): string {
  if (!out || noSpace) return `${out}${next}`
  return `${out} ${next}`
}

export function rebuildCommandFromTokens(
  tokens: ParseEntry[],
  fallback: string,
): string {
  if (tokens.length === 0) return fallback
  let out = ''
  let parenDepth = 0
  let inProcessSubstitution = false

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    const prev = tokens[i - 1]
    const next = tokens[i + 1]

    if (typeof token === 'string') {
      const raw = token
      const restored = restoreShellStringToken(raw)
      const cameFromQuotedString =
        raw.includes(SINGLE_QUOTE) || raw.includes(DOUBLE_QUOTE)
      const needsQuoting = cameFromQuotedString
        ? restored
        : /[|&;]/.test(restored)
          ? `"${restored}"`
          : isWeirdTokenNeedingQuotes(restored)
            ? quote([restored])
            : restored

      const endsWithDollar = needsQuoting.endsWith('$')
      const nextIsParen =
        !!next &&
        typeof next === 'object' &&
        'op' in (next as any) &&
        (next as any).op === '('
      const noSpace =
        out.endsWith('(') ||
        prev === '$' ||
        (!!prev &&
          typeof prev === 'object' &&
          'op' in (prev as any) &&
          (prev as any).op === ')')

      if (out.endsWith('<(')) {
        out += ` ${needsQuoting}`
      } else {
        out = joinTokensWithMinimalSpacing(out, needsQuoting, noSpace)
      }
      void endsWithDollar
      void nextIsParen
      continue
    }

    if (!token || typeof token !== 'object' || !('op' in token)) continue

    const op = String((token as any).op)
    if (op === 'glob' && 'pattern' in token) {
      out = joinTokensWithMinimalSpacing(
        out,
        String((token as any).pattern),
        false,
      )
      continue
    }

    if (
      op === '>&' &&
      typeof prev === 'string' &&
      /^\d+$/.test(prev) &&
      typeof next === 'string' &&
      /^\d+$/.test(next)
    ) {
      const idx = out.lastIndexOf(prev)
      if (idx !== -1) {
        out = out.slice(0, idx) + `${prev}${op}${next}`
        i++
        continue
      }
    }

    if (op === '<' && isOpToken(next, '<')) {
      const after = tokens[i + 2]
      if (typeof after === 'string') {
        out = joinTokensWithMinimalSpacing(out, after, false)
        i += 2
        continue
      }
    }

    if (op === '<<<') {
      out = joinTokensWithMinimalSpacing(out, op, false)
      continue
    }

    if (op === '(') {
      if (hasUnescapedVarSuffixToken(prev, tokens, i) || parenDepth > 0) {
        parenDepth++
        if (out.endsWith(' ')) out = out.slice(0, -1)
        out += '('
      } else if (out.endsWith('$')) {
        if (hasUnescapedVarSuffixToken(prev, tokens, i)) {
          parenDepth++
          out += '('
        } else {
          out = joinTokensWithMinimalSpacing(out, '(', false)
        }
      } else {
        const noSpace = out.endsWith('<(') || out.endsWith('(')
        out = joinTokensWithMinimalSpacing(out, '(', noSpace)
      }
      continue
    }

    if (op === ')') {
      if (inProcessSubstitution) {
        inProcessSubstitution = false
        out += ')'
        continue
      }
      if (parenDepth > 0) parenDepth--
      out += ')'
      continue
    }

    if (op === '<(') {
      inProcessSubstitution = true
      out = joinTokensWithMinimalSpacing(out, op, false)
      continue
    }

    if (['&&', '||', '|', ';', '>', '>>', '<'].includes(op)) {
      out = joinTokensWithMinimalSpacing(out, op, false)
      continue
    }
  }

  return out.trim() || fallback
}
