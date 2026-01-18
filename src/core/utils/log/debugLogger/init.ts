import chalk from 'chalk'
import { DEBUG_PATHS, DEBUG_VERBOSE_TERMINAL_LOG_LEVELS, TERMINAL_LOG_LEVELS, STARTUP_TIMESTAMP } from './constants'
import { debug } from './core'
import { isDebugMode, isDebugVerboseMode } from './flags'
import { terminalLog } from './terminal'
import { SESSION_ID } from '../index'

export function initDebugLogger() {
  if (!isDebugMode()) return

  debug.info('DEBUG_LOGGER_INIT', {
    startupTimestamp: STARTUP_TIMESTAMP,
    sessionId: SESSION_ID,
    debugPaths: {
      detailed: DEBUG_PATHS.detailed(),
      flow: DEBUG_PATHS.flow(),
      api: DEBUG_PATHS.api(),
      state: DEBUG_PATHS.state(),
    },
  })

  const terminalLevels = isDebugVerboseMode()
    ? Array.from(DEBUG_VERBOSE_TERMINAL_LOG_LEVELS).join(', ')
    : Array.from(TERMINAL_LOG_LEVELS).join(', ')

  terminalLog(
    chalk.dim(`[DEBUG] Terminal output filtered to: ${terminalLevels}`),
  )
  terminalLog(
    chalk.dim(`[DEBUG] Complete logs saved to: ${DEBUG_PATHS.base()}`),
  )
  if (!isDebugVerboseMode()) {
    terminalLog(
      chalk.dim(
        `[DEBUG] Use --debug-verbose for detailed system logs (FLOW, API, STATE)`,
      ),
    )
  }
}
