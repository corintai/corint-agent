import { existsSync, statSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { homedir } from 'os'

export function getClaudePolicyBaseDir(): string {
  switch (process.platform) {
    case 'darwin':
      return '/Library/Application Support/ClaudeCode'
    case 'win32':
      return existsSync('C:\\Program Files\\ClaudeCode')
        ? 'C:\\Program Files\\ClaudeCode'
        : 'C:\\ProgramData\\ClaudeCode'
    default:
      return '/etc/claude-code'
  }
}

function normalizeOverride(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? resolve(trimmed) : null
}

function dedupeStrings(values: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    if (!value) continue
    if (seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

export function getUserConfigRoots(): string[] {
  const claudeOverride = normalizeOverride(process.env.CLAUDE_CONFIG_DIR)
  const kodeOverride = normalizeOverride(process.env.CORINT_CONFIG_DIR)

  const hasAnyOverride = Boolean(claudeOverride || kodeOverride)
  if (hasAnyOverride) {
    return dedupeStrings([claudeOverride ?? '', kodeOverride ?? ''])
  }

  return dedupeStrings([join(homedir(), '.claude'), join(homedir(), '.corint')])
}

export function findProjectAgentDirs(cwd: string): string[] {
  const result: string[] = []
  const home = resolve(homedir())
  let current = resolve(cwd)

  while (current !== home) {
    const claudeDir = join(current, '.claude', 'agents')
    if (existsSync(claudeDir)) result.push(claudeDir)

    const corintDir = join(current, '.corint', 'agents')
    if (existsSync(corintDir)) result.push(corintDir)

    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }

  return result
}

export function inodeKeyForPath(filePath: string): string | null {
  try {
    const st = statSync(filePath)
    if (
      typeof (st as any).dev === 'number' &&
      typeof (st as any).ino === 'number'
    ) {
      return `${(st as any).dev}:${(st as any).ino}`
    }
    return null
  } catch {
    return null
  }
}
