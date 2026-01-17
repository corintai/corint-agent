import type { ParseEntry } from 'shell-quote'

import {
  isOpToken,
  isSimplePathToken,
  parseShellTokens,
  rebuildCommandFromTokens,
} from './parser'

export type Redirection = { target: string; operator: '>' | '>>' }

export type RedirectionParseResult = {
  commandWithoutRedirections: string
  redirections: Redirection[]
}

export function stripOutputRedirections(
  command: string,
): RedirectionParseResult {
  const parsed = parseShellTokens(command)
  if (!parsed.success)
    return { commandWithoutRedirections: command, redirections: [] }

  const tokens = parsed.tokens
  const redirections: Redirection[] = []

  const parenToStrip = new Set<number>()
  const parenStack: Array<{ index: number; isStart: boolean }> = []

  tokens.forEach((token, index) => {
    if (isOpToken(token, '(')) {
      const prev = tokens[index - 1]
      const isStart =
        index === 0 ||
        (!!prev &&
          typeof prev === 'object' &&
          'op' in (prev as any) &&
          ['&&', '||', ';', '|'].includes(String((prev as any).op)))
      parenStack.push({ index, isStart })
    } else if (isOpToken(token, ')') && parenStack.length > 0) {
      const start = parenStack.pop()!
      const next = tokens[index + 1]
      if (start.isStart && (isOpToken(next, '>') || isOpToken(next, '>>'))) {
        parenToStrip.add(start.index).add(index)
      }
    }
  })

  const outTokens: ParseEntry[] = []
  let dollarParenDepth = 0

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (!token) continue

    const prev = tokens[i - 1]
    const next = tokens[i + 1]
    const afterNext = tokens[i + 2]

    if (
      (isOpToken(token, '(') || isOpToken(token, ')')) &&
      parenToStrip.has(i)
    ) {
      continue
    }

    if (
      isOpToken(token, '(') &&
      typeof prev === 'string' &&
      prev.endsWith('$')
    ) {
      dollarParenDepth++
    } else if (isOpToken(token, ')') && dollarParenDepth > 0) {
      dollarParenDepth--
    }

    if (dollarParenDepth === 0) {
      const { skip } = maybeConsumeRedirection(
        token,
        prev,
        next,
        afterNext,
        redirections,
        outTokens,
      )
      if (skip > 0) {
        i += skip
        continue
      }
    }

    outTokens.push(token)
  }

  return {
    commandWithoutRedirections: rebuildCommandFromTokens(outTokens, command),
    redirections,
  }
}

function maybeConsumeRedirection(
  token: ParseEntry,
  prev: ParseEntry | undefined,
  next: ParseEntry | undefined,
  afterNext: ParseEntry | undefined,
  redirections: Redirection[],
  outputTokens: ParseEntry[],
): { skip: number } {
  const isFd = (v: unknown) => typeof v === 'string' && /^\d+$/.test(v.trim())

  if (isOpToken(token, '>') || isOpToken(token, '>>')) {
    const operator = String((token as any).op) as '>' | '>>'
    if (isFd(prev)) {
      return consumeRedirectionWithFd(
        prev.trim(),
        operator,
        next,
        redirections,
        outputTokens,
      )
    }

    if (isOpToken(next, '|') && isSimplePathToken(afterNext)) {
      redirections.push({ target: String(afterNext), operator })
      return { skip: 2 }
    }

    if (isSimplePathToken(next)) {
      redirections.push({ target: String(next), operator })
      return { skip: 1 }
    }
  }

  if (isOpToken(token, '>&')) {
    if (isFd(prev) && isFd(next)) {
      return { skip: 0 }
    }
    if (isSimplePathToken(next)) {
      redirections.push({ target: String(next), operator: '>' })
      return { skip: 1 }
    }
  }

  return { skip: 0 }
}

function consumeRedirectionWithFd(
  fd: string,
  operator: '>' | '>>',
  next: ParseEntry | undefined,
  redirections: Redirection[],
  outputTokens: ParseEntry[],
): { skip: number } {
  const isStdout = fd === '1'
  const nextIsPath = typeof next === 'string' && isSimplePathToken(next)

  if (redirections.length > 0) redirections.pop()

  if (nextIsPath) {
    redirections.push({ target: String(next), operator })
    if (!isStdout) outputTokens.push(`${fd}${operator}`, String(next))
    return { skip: 1 }
  }

  if (!isStdout) {
    outputTokens.push(`${fd}${operator}`)
  }

  return { skip: 0 }
}
