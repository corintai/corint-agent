import { minimatch } from 'minimatch'

export function matcherMatchesTool(matcher: string, toolName: string): boolean {
  if (!matcher) return false
  if (matcher === '*' || matcher === 'all') return true
  if (matcher === toolName) return true
  try {
    if (minimatch(toolName, matcher, { dot: true, nocase: false })) return true
  } catch {}
  try {
    if (new RegExp(matcher).test(toolName)) return true
  } catch {}
  return false
}
