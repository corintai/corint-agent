import { LogLevel } from './types'

const recentLogs = new Map<string, number>()
const LOG_DEDUPE_WINDOW_MS = 5000

function getDedupeKey(level: LogLevel, phase: string, data: any): string {
  if (phase.startsWith('CONFIG_')) {
    const file = data?.file || ''
    return `${level}:${phase}:${file}`
  }

  return `${level}:${phase}`
}

export function shouldLogWithDedupe(
  level: LogLevel,
  phase: string,
  data: any,
): boolean {
  const key = getDedupeKey(level, phase, data)
  const now = Date.now()
  const lastLogTime = recentLogs.get(key)

  if (!lastLogTime || now - lastLogTime > LOG_DEDUPE_WINDOW_MS) {
    recentLogs.set(key, now)

    for (const [oldKey, oldTime] of recentLogs.entries()) {
      if (now - oldTime > LOG_DEDUPE_WINDOW_MS) {
        recentLogs.delete(oldKey)
      }
    }

    return true
  }

  return false
}
