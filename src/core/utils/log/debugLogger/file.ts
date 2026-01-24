import { existsSync, mkdirSync, appendFileSync } from 'fs'
import { SESSION_ID } from '../index'
import { DEBUG_PATHS, REQUEST_START_TIME } from './constants'
import { isDebugMode } from './flags'
import type { LogEntry } from './types'

function ensureDebugDir() {
  const debugDir = DEBUG_PATHS.base()
  if (!existsSync(debugDir)) {
    mkdirSync(debugDir, { recursive: true })
  }
}

export function writeToFile(filePath: string, entry: LogEntry) {
  if (!isDebugMode()) return

  try {
    ensureDebugDir()
    const logLine =
      JSON.stringify(
        {
          ...entry,
          sessionId: SESSION_ID,
          pid: process.pid,
          uptime: Date.now() - REQUEST_START_TIME,
        },
        null,
        2,
      ) + ',\n'

    appendFileSync(filePath, logLine)
  } catch (error) {
    // Silently ignore file write errors in debug logging to avoid disrupting main flow
    // Common causes: disk full, permission denied, file locked
  }
}
