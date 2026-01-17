import type { ToolPermissionContext } from '@kode-types/toolPermissionContext'

import type { BashPermissionDecision } from './types'
import { parseShellTokens, splitBashCommandIntoSubcommands } from './parser'

function flagsAreAllowed(flags: string[], allowed: string[]): boolean {
  for (const flag of flags) {
    if (flag.startsWith('-') && !flag.startsWith('--') && flag.length > 2) {
      for (let i = 1; i < flag.length; i++) {
        const expanded = `-${flag[i]}`
        if (!allowed.includes(expanded)) return false
      }
    } else if (!allowed.includes(flag)) {
      return false
    }
  }
  return true
}

function sedScriptIsSafePrintOnly(script: string): boolean {
  if (!script) return false
  if (!script.endsWith('p')) return false
  if (script === 'p') return true
  const prefix = script.slice(0, -1)
  if (/^\d+$/.test(prefix)) return true
  if (/^\d+,\d+$/.test(prefix)) return true
  return false
}

function sedIsSafePrintCommand(command: string, scripts: string[]): boolean {
  const match = command.match(/^\s*sed\s+/)
  if (!match) return false
  const rest = command.slice(match[0].length)
  const parsed = parseShellTokens(rest)
  if (!parsed.success) return false

  const flags: string[] = []
  for (const token of parsed.tokens) {
    if (typeof token === 'string' && token.startsWith('-') && token !== '--')
      flags.push(token)
  }

  if (
    !flagsAreAllowed(flags, [
      '-n',
      '--quiet',
      '--silent',
      '-E',
      '--regexp-extended',
      '-r',
      '-z',
      '--zero-terminated',
      '--posix',
    ])
  ) {
    return false
  }

  const hasNoPrint = flags.some(
    f =>
      f === '-n' ||
      f === '--quiet' ||
      f === '--silent' ||
      (f.startsWith('-') && !f.startsWith('--') && f.includes('n')),
  )
  if (!hasNoPrint) return false

  if (scripts.length === 0) return false
  for (const script of scripts) {
    for (const part of script.split(';')) {
      if (!sedScriptIsSafePrintOnly(part.trim())) return false
    }
  }
  return true
}

function sedIsSafeSimpleSubstitution(
  command: string,
  scripts: string[],
  hasExtraExpressions: boolean,
  options?: { allowFileWrites?: boolean },
): boolean {
  const allowFileWrites = options?.allowFileWrites ?? false
  if (!allowFileWrites && hasExtraExpressions) return false

  const match = command.match(/^\s*sed\s+/)
  if (!match) return false
  const rest = command.slice(match[0].length)
  const parsed = parseShellTokens(rest)
  if (!parsed.success) return false

  const flags: string[] = []
  for (const token of parsed.tokens) {
    if (typeof token === 'string' && token.startsWith('-') && token !== '--')
      flags.push(token)
  }

  const allowedFlags = ['-E', '--regexp-extended', '-r', '--posix']
  if (allowFileWrites) allowedFlags.push('-i', '--in-place')
  if (!flagsAreAllowed(flags, allowedFlags)) return false

  if (scripts.length !== 1) return false
  const script = scripts[0]?.trim() ?? ''
  if (!script.startsWith('s')) return false
  const matchScript = script.match(/^s\/(.*?)$/)
  if (!matchScript) return false

  const body = matchScript[1]
  let slashCount = 0
  let lastSlashIndex = -1
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\') {
      i++
      continue
    }
    if (body[i] === '/') {
      slashCount++
      lastSlashIndex = i
    }
  }
  if (slashCount !== 2) return false

  const flagsPart = body.slice(lastSlashIndex + 1)
  if (!/^[gpimIM]*[1-9]?[gpimIM]*$/.test(flagsPart)) return false
  return true
}

function sedHasExtraExpressions(command: string): boolean {
  const match = command.match(/^\s*sed\s+/)
  if (!match) return false
  const rest = command.slice(match[0].length)
  const parsed = parseShellTokens(rest)
  if (!parsed.success) return true

  const tokens = parsed.tokens
  try {
    let nonFlagCount = 0
    let sawExpressionFlag = false
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]
      if (
        token &&
        typeof token === 'object' &&
        'op' in token &&
        (token as any).op === 'glob'
      )
        return true
      if (typeof token !== 'string') continue

      if (
        (token === '-e' || token === '--expression') &&
        i + 1 < tokens.length
      ) {
        sawExpressionFlag = true
        i++
        continue
      }
      if (token.startsWith('--expression=')) {
        sawExpressionFlag = true
        continue
      }
      if (token.startsWith('-e=')) {
        sawExpressionFlag = true
        continue
      }
      if (token.startsWith('-')) continue

      nonFlagCount++
      if (sawExpressionFlag) return true
      if (nonFlagCount > 1) return true
    }
    return false
  } catch {
    return true
  }
}

function extractSedScripts(command: string): string[] {
  const scripts: string[] = []
  const match = command.match(/^\s*sed\s+/)
  if (!match) return scripts

  const rest = command.slice(match[0].length)
  if (/-e[wWe]/.test(rest) || /-w[eE]/.test(rest)) {
    throw new Error('Dangerous flag combination detected')
  }

  const parsed = parseShellTokens(rest)
  if ('error' in parsed) {
    throw new Error(`Malformed shell syntax: ${parsed.error}`)
  }

  const tokens = parsed.tokens
  try {
    let sawExpressionFlag = false
    let sawInlineScript = false
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]
      if (typeof token !== 'string') continue

      if (
        (token === '-e' || token === '--expression') &&
        i + 1 < tokens.length
      ) {
        sawExpressionFlag = true
        const next = tokens[i + 1]
        if (typeof next === 'string') {
          scripts.push(next)
          i++
        }
        continue
      }
      if (token.startsWith('--expression=')) {
        sawExpressionFlag = true
        scripts.push(token.slice(13))
        continue
      }
      if (token.startsWith('-e=')) {
        sawExpressionFlag = true
        scripts.push(token.slice(3))
        continue
      }
      if (token.startsWith('-')) continue
      if (!sawExpressionFlag && !sawInlineScript) {
        scripts.push(token)
        sawInlineScript = true
        continue
      }
      break
    }
  } catch (error) {
    throw new Error(
      `Failed to parse sed command: ${error instanceof Error ? error.message : 'Unknown error'}`,
    )
  }

  return scripts
}

function sedScriptContainsDangerousOperations(script: string): boolean {
  const s = script.trim()
  if (!s) return false
  if (/[^\x01-\x7F]/.test(s)) return true
  if (s.includes('{') || s.includes('}')) return true
  if (s.includes('\n')) return true

  const commentIndex = s.indexOf('#')
  if (commentIndex !== -1 && !(commentIndex > 0 && s[commentIndex - 1] === 's'))
    return true

  if (/^!/.test(s) || /[/\d$]!/.test(s)) return true
  if (/\d\s*~\s*\d|,\s*~\s*\d|\$\s*~\s*\d/.test(s)) return true
  if (/^,/.test(s)) return true
  if (/,\s*[+-]/.test(s)) return true
  if (/s\\/.test(s) || /\\[|#%@]/.test(s)) return true
  if (/\\\/.*[wW]/.test(s)) return true
  if (/\/[^/]*\s+[wWeE]/.test(s)) return true
  if (/^s\//.test(s) && !/^s\/[^/]*\/[^/]*\/[^/]*$/.test(s)) return true

  if (/^s./.test(s) && /[wWeE]$/.test(s)) {
    if (!/^s([^\\\n]).*?\1.*?\1[^wWeE]*$/.test(s)) return true
  }

  if (
    /^[wW]\s*\S+/.test(s) ||
    /^\d+\s*[wW]\s*\S+/.test(s) ||
    /^\$\s*[wW]\s*\S+/.test(s) ||
    /^\/[^/]*\/[IMim]*\s*[wW]\s*\S+/.test(s) ||
    /^\d+,\d+\s*[wW]\s*\S+/.test(s) ||
    /^\d+,\$\s*[wW]\s*\S+/.test(s) ||
    /^\/[^/]*\/[IMim]*,\/[^/]*\/[IMim]*\s*[wW]\s*\S+/.test(s)
  ) {
    return true
  }

  if (
    /^e/.test(s) ||
    /^\d+\s*e/.test(s) ||
    /^\$\s*e/.test(s) ||
    /^\/[^/]*\/[IMim]*\s*e/.test(s) ||
    /^\d+,\d+\s*e/.test(s) ||
    /^\d+,\$\s*e/.test(s) ||
    /^\/[^/]*\/[IMim]*,\/[^/]*\/[IMim]*\s*e/.test(s)
  ) {
    return true
  }

  const m = s.match(/s([^\\\n]).*?\1.*?\1(.*?)$/)
  if (m) {
    const flags = m[2] || ''
    if (flags.includes('w') || flags.includes('W')) return true
    if (flags.includes('e') || flags.includes('E')) return true
  }

  if (s.match(/y([^\\\n])/)) {
    if (/[wWeE]/.test(s)) return true
  }

  return false
}

function sedCommandIsSafe(
  command: string,
  options?: { allowFileWrites?: boolean },
): boolean {
  const allowFileWrites = options?.allowFileWrites ?? false
  let scripts: string[]
  try {
    scripts = extractSedScripts(command)
  } catch {
    return false
  }

  const hasExtraExpressions = sedHasExtraExpressions(command)

  let safePrint = false
  let safeSub = false
  if (allowFileWrites) {
    safeSub = sedIsSafeSimpleSubstitution(
      command,
      scripts,
      hasExtraExpressions,
      { allowFileWrites: true },
    )
  } else {
    safePrint = sedIsSafePrintCommand(command, scripts)
    safeSub = sedIsSafeSimpleSubstitution(command, scripts, hasExtraExpressions)
  }

  if (!safePrint && !safeSub) return false

  for (const script of scripts) {
    if (safeSub && script.includes(';')) return false
  }
  for (const script of scripts) {
    if (sedScriptContainsDangerousOperations(script)) return false
  }
  return true
}

export function checkSedCommandSafety(args: {
  command: string
  toolPermissionContext: ToolPermissionContext
}): BashPermissionDecision {
  const subcommands = splitBashCommandIntoSubcommands(args.command)
  for (const subcommand of subcommands) {
    const trimmed = subcommand.trim()
    const base = trimmed.split(/\s+/)[0]
    if (base !== 'sed') continue
    const allowFileWrites = args.toolPermissionContext.mode === 'acceptEdits'
    if (!sedCommandIsSafe(trimmed, { allowFileWrites })) {
      return {
        behavior: 'ask',
        message:
          'sed command requires approval (contains potentially dangerous operations)',
        decisionReason: {
          type: 'other',
          reason:
            'sed command contains operations that require explicit approval (e.g., write commands, execute commands)',
        },
      }
    }
  }
  return {
    behavior: 'passthrough',
    message: 'No dangerous sed operations detected',
  }
}
