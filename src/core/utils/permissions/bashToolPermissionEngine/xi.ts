export function parseBoolLikeEnv(value: string | undefined): boolean {
  if (!value) return false
  const v = value.trim().toLowerCase()
  return ['1', 'true', 'yes', 'y', 'on', 'enable', 'enabled'].includes(v)
}

type XiContext = {
  originalCommand: string
  baseCommand: string
  unquotedContent: string
  fullyUnquotedContent: string
}

type XiDecision =
  | { behavior: 'passthrough'; message: string }
  | { behavior: 'ask'; message: string }

function qQ5(
  input: string,
  keepDoubleQuotes = false,
): { withDoubleQuotes: string; fullyUnquoted: string } {
  let withDoubleQuotes = ''
  let fullyUnquoted = ''
  let inSingle = false
  let inDouble = false
  let escape = false

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!
    if (escape) {
      escape = false
      if (!inSingle) withDoubleQuotes += ch
      if (!inSingle && !inDouble) fullyUnquoted += ch
      continue
    }
    if (ch === '\\') {
      escape = true
      if (!inSingle) withDoubleQuotes += ch
      if (!inSingle && !inDouble) fullyUnquoted += ch
      continue
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle
      continue
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble
      if (!keepDoubleQuotes) continue
    }
    if (!inSingle) withDoubleQuotes += ch
    if (!inSingle && !inDouble) fullyUnquoted += ch
  }

  return { withDoubleQuotes, fullyUnquoted }
}

function NQ5(input: string): string {
  return input
    .replace(/\s+2\s*>&\s*1(?=\s|$)/g, '')
    .replace(/[012]?\s*>\s*\/dev\/null/g, '')
    .replace(/\s*<\s*\/dev\/null/g, '')
}

function hasUnescapedChar(input: string, ch: string): boolean {
  if (ch.length !== 1)
    throw new Error('hasUnescapedChar only works with single characters')
  let i = 0
  while (i < input.length) {
    if (input[i] === '\\' && i + 1 < input.length) {
      i += 2
      continue
    }
    if (input[i] === ch) return true
    i++
  }
  return false
}

function MQ5(ctx: XiContext): {
  behavior: 'allow' | 'passthrough'
  message?: string
} {
  if (!ctx.originalCommand.trim()) {
    return { behavior: 'allow', message: 'Empty command is safe' }
  }
  return { behavior: 'passthrough', message: 'Command is not empty' }
}

function OQ5(ctx: XiContext): XiDecision {
  const cmd = ctx.originalCommand
  const trimmed = cmd.trim()
  if (/^\s*\t/.test(cmd))
    return {
      behavior: 'ask',
      message: 'Command appears to be an incomplete fragment (starts with tab)',
    }
  if (trimmed.startsWith('-'))
    return {
      behavior: 'ask',
      message:
        'Command appears to be an incomplete fragment (starts with flags)',
    }
  if (/^\s*(&&|\|\||;|>>?|<)/.test(cmd)) {
    return {
      behavior: 'ask',
      message:
        'Command appears to be a continuation line (starts with operator)',
    }
  }
  return { behavior: 'passthrough', message: 'Command appears complete' }
}

const HEREDOC_IN_SUBSTITUTION = /\$\(.*<</

function RQ5(command: string): boolean {
  if (!HEREDOC_IN_SUBSTITUTION.test(command)) return false
  try {
    const re = /\$\(cat\s*<<-?\s*(?:'+([A-Za-z_]\w*)'+|\\([A-Za-z_]\w*))/g
    const matches: Array<{ start: number; delimiter: string }> = []
    let m: RegExpExecArray | null
    while ((m = re.exec(command)) !== null) {
      const delimiter = m[1] || m[2]
      if (delimiter) matches.push({ start: m.index, delimiter })
    }
    if (matches.length === 0) return false

    for (const { start, delimiter } of matches) {
      const tail = command.substring(start)
      const escaped = delimiter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (!new RegExp(`(?:\\n|^[^\\n]*\\n)${escaped}\\s*\\)`).test(tail))
        return false
      const full = new RegExp(
        `^\\$\\(cat\\s*<<-?\\s*(?:'+${escaped}'+|\\\\${escaped})[^\\n]*\\n(?:[\\s\\S]*?\\n)?${escaped}\\s*\\)` ,
      )
      if (!tail.match(full)) return false
    }

    let remaining = command
    for (const { delimiter } of matches) {
      const escaped = delimiter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const pattern = new RegExp(
        `\\$\\(cat\\s*<<-?\\s*(?:'+${escaped}'+|\\\\${escaped})[^\\n]*\\n(?:[\\s\\S]*?\\n)?${escaped}\\s*\\)` ,
      )
      remaining = remaining.replace(pattern, '')
    }

    if (/\$\(/.test(remaining)) return false
    if (/\$\{/.test(remaining)) return false
    return true
  } catch {
    return false
  }
}

function TQ5(ctx: XiContext): {
  behavior: 'allow' | 'passthrough'
  message?: string
} {
  if (!HEREDOC_IN_SUBSTITUTION.test(ctx.originalCommand)) {
    return { behavior: 'passthrough', message: 'No heredoc in substitution' }
  }
  if (RQ5(ctx.originalCommand)) {
    return {
      behavior: 'allow',
      message:
        'Safe command substitution: cat with quoted/escaped heredoc delimiter',
    }
  }
  return {
    behavior: 'passthrough',
    message: 'Command substitution needs validation',
  }
}

function jQ5(ctx: XiContext): {
  behavior: 'allow' | 'ask' | 'passthrough'
  message: string
} {
  const cmd = ctx.originalCommand
  if (ctx.baseCommand !== 'git' || !/^git\s+commit\s+/.test(cmd)) {
    return { behavior: 'passthrough', message: 'Not a git commit' }
  }
  const match = cmd.match(/^git\s+commit\s+.*-m\s+(["'])([\s\S]*?)\1(.*)$/)
  if (!match)
    return { behavior: 'passthrough', message: 'Git commit needs validation' }

  const [, quoteChar, message, tail] = match
  if (quoteChar === '"' && message && /\$\(|`|\$\{/.test(message)) {
    return {
      behavior: 'ask',
      message: 'Git commit message contains command substitution patterns',
    }
  }
  if (tail && /\$\(|`|\$\{/.test(tail)) {
    return { behavior: 'passthrough', message: 'Check patterns in flags' }
  }
  return {
    behavior: 'allow',
    message: 'Git commit with simple quoted message is allowed',
  }
}

function PQ5(ctx: XiContext): {
  behavior: 'allow' | 'passthrough'
  message: string
} {
  if (HEREDOC_IN_SUBSTITUTION.test(ctx.originalCommand)) {
    return { behavior: 'passthrough', message: 'Heredoc in substitution' }
  }
  const safeQuoted = /<<-?\s*'[^']+'/
  const safeEscaped = /<<-?\s*\\\w+/
  if (
    safeQuoted.test(ctx.originalCommand) ||
    safeEscaped.test(ctx.originalCommand)
  ) {
    return {
      behavior: 'allow',
      message: 'Heredoc with quoted/escaped delimiter is safe',
    }
  }
  return { behavior: 'passthrough', message: 'No heredoc patterns' }
}

function SQ5(ctx: XiContext): XiDecision {
  if (ctx.baseCommand !== 'jq')
    return { behavior: 'passthrough', message: 'Not jq' }
  if (/\bsystem\s*\(/.test(ctx.originalCommand)) {
    return {
      behavior: 'ask',
      message:
        'jq command contains system() function which executes arbitrary commands',
    }
  }
  const rest = ctx.originalCommand.substring(3).trim()
  if (
    /(?:^|\s)(?:-f\b|--from-file|--rawfile|--slurpfile|-L\b|--library-path)/.test(
      rest,
    )
  ) {
    return {
      behavior: 'ask',
      message:
        'jq command contains dangerous flags that could execute code or read arbitrary files',
    }
  }
  return { behavior: 'passthrough', message: 'jq command is safe' }
}

function _Q5(ctx: XiContext): XiDecision {
  const q = ctx.unquotedContent
  const msg = 'Command contains shell metacharacters (;, |, or &) in arguments'
  if (/(?:^|\s)["'][^"']*[;&][^"']*["'](?:\s|$)/.test(q))
    return { behavior: 'ask', message: msg }
  if (
    [
      /-name\s+["'][^"']*[;|&][^"']*["']/,
      /-path\s+["'][^"']*[;|&][^"']*["']/,
      /-iname\s+["'][^"']*[;|&][^"']*["']/,
    ].some(re => re.test(q))
  ) {
    return { behavior: 'ask', message: msg }
  }
  if (/-regex\s+["'][^"']*[;&][^"']*["']/.test(q))
    return { behavior: 'ask', message: msg }
  return { behavior: 'passthrough', message: 'No metacharacters' }
}

function yQ5(ctx: XiContext): XiDecision {
  const q = ctx.fullyUnquotedContent
  if (
    /[<>|]\s*\$[A-Za-z_]/.test(q) ||
    /\$[A-Za-z_][A-Za-z0-9_]*\s*[|<>]/.test(q)
  ) {
    return {
      behavior: 'ask',
      message:
        'Command contains variables in dangerous contexts (redirections or pipes)',
    }
  }
  return { behavior: 'passthrough', message: 'No dangerous variables' }
}

const DANGEROUS_PATTERNS = [
  { pattern: /<\(/, message: 'process substitution <()' },
  { pattern: />\(/, message: 'process substitution >()' },
  { pattern: /\$\(/, message: '$() command substitution' },
  { pattern: /\$\{/, message: '${} parameter substitution' },
  { pattern: /~\[/, message: 'Zsh-style parameter expansion' },
  { pattern: /\(e:/, message: 'Zsh-style glob qualifiers' },
  { pattern: /<#/, message: 'PowerShell comment syntax' },
]

function kQ5(ctx: XiContext): XiDecision {
  const unquoted = ctx.unquotedContent
  const fully = ctx.fullyUnquotedContent
  if (hasUnescapedChar(unquoted, '`'))
    return {
      behavior: 'ask',
      message: 'Command contains backticks (`) for command substitution',
    }
  for (const { pattern, message } of DANGEROUS_PATTERNS) {
    if (pattern.test(unquoted))
      return { behavior: 'ask', message: `Command contains ${message}` }
  }
  if (/</.test(fully))
    return {
      behavior: 'ask',
      message:
        'Command contains input redirection (<) which could read sensitive files',
    }
  if (/>/.test(fully))
    return {
      behavior: 'ask',
      message:
        'Command contains output redirection (>) which could write to arbitrary files',
    }
  return { behavior: 'passthrough', message: 'No dangerous patterns' }
}

function xQ5(ctx: XiContext): XiDecision {
  const q = ctx.fullyUnquotedContent
  if (!/[\n\r]/.test(q))
    return { behavior: 'passthrough', message: 'No newlines' }
  if (/[\n\r]\s*[a-zA-Z/.~]/.test(q))
    return {
      behavior: 'ask',
      message:
        'Command contains newlines that could separate multiple commands',
    }
  return {
    behavior: 'passthrough',
    message: 'Newlines appear to be within data',
  }
}

function vQ5(ctx: XiContext): XiDecision {
  if (/\$IFS|\$\{[^}]*IFS/.test(ctx.originalCommand)) {
    return {
      behavior: 'ask',
      message:
        'Command contains IFS variable usage which could bypass security validation',
    }
  }
  return { behavior: 'passthrough', message: 'No IFS injection detected' }
}

function bQ5(ctx: XiContext): XiDecision {
  if (ctx.baseCommand === 'echo')
    return {
      behavior: 'passthrough',
      message: 'echo command is safe and has no dangerous flags',
    }

  const cmd = ctx.originalCommand
  let inSingle = false
  let inDouble = false
  let escape = false
  for (let i = 0; i < cmd.length - 1; i++) {
    const ch = cmd[i]!
    const next = cmd[i + 1]!
    if (escape) {
      escape = false
      continue
    }
    if (ch === '\\') {
      escape = true
      continue
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle
      continue
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble
      continue
    }
    if (inSingle || inDouble) continue

    if (/\s/.test(ch) && next === '-') {
      let j = i + 1
      let current = ''
      while (j < cmd.length) {
        const v = cmd[j]
        if (!v) break
        if (/[\s=]/.test(v)) break
        if (/['"`]/.test(v)) {
          if (ctx.baseCommand === 'cut' && current === '-d') break
          if (j + 1 < cmd.length) {
            const after = cmd[j + 1]!
            if (!/[a-zA-Z0-9_'"-]/.test(after)) break
          }
        }
        current += v
        j++
      }
      if (current.includes('"') || current.includes("'")) {
        return {
          behavior: 'ask',
          message: 'Command contains quoted characters in flag names',
        }
      }
    }
  }

  const fully = ctx.fullyUnquotedContent
  if (/\s['"`]-/.test(fully))
    return {
      behavior: 'ask',
      message: 'Command contains quoted characters in flag names',
    }
  if (/['"`]{2}-/.test(fully))
    return {
      behavior: 'ask',
      message: 'Command contains quoted characters in flag names',
    }

  return { behavior: 'passthrough', message: 'No obfuscated flags detected' }
}

export function xi(command: string): XiDecision {
  const base = command.split(' ')[0] || ''
  const { withDoubleQuotes, fullyUnquoted } = qQ5(command, base === 'jq')
  const ctx: XiContext = {
    originalCommand: command,
    baseCommand: base,
    unquotedContent: withDoubleQuotes,
    fullyUnquotedContent: NQ5(fullyUnquoted),
  }

  const allowChecks = [MQ5, OQ5, TQ5, PQ5, jQ5]
  for (const check of allowChecks) {
    const res: any = check(ctx as any)
    if (res.behavior === 'allow')
      return {
        behavior: 'passthrough',
        message: res.message ?? 'Command allowed',
      }
    if (res.behavior !== 'passthrough') return res
  }

  const askChecks = [SQ5, bQ5, _Q5, yQ5, xQ5, vQ5, kQ5]
  for (const check of askChecks) {
    const res = check(ctx)
    if (res.behavior === 'ask') return res
  }

  return {
    behavior: 'passthrough',
    message: 'Command passed all security checks',
  }
}
