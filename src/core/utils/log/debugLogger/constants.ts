import { homedir } from 'os'
import { join } from 'path'
import { LogLevel } from './types'

export const TERMINAL_LOG_LEVELS = new Set([
  LogLevel.ERROR,
  LogLevel.WARN,
  LogLevel.INFO,
  LogLevel.REMINDER,
])

export const DEBUG_VERBOSE_TERMINAL_LOG_LEVELS = new Set([
  LogLevel.ERROR,
  LogLevel.WARN,
  LogLevel.FLOW,
  LogLevel.API,
  LogLevel.STATE,
  LogLevel.INFO,
  LogLevel.REMINDER,
])

export const USER_FRIENDLY_LEVELS = new Set([
  'SESSION_START',
  'QUERY_START',
  'QUERY_PROGRESS',
  'QUERY_COMPLETE',
  'TOOL_EXECUTION',
  'ERROR_OCCURRED',
  'PERFORMANCE_SUMMARY',
])

export const STARTUP_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-')
export const REQUEST_START_TIME = Date.now()

const CORINT_DIR = join(homedir(), '.corint')
function getProjectDir(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

export const DEBUG_PATHS = {
  base: () => join(CORINT_DIR, getProjectDir(process.cwd()), 'debug'),
  detailed: () => join(DEBUG_PATHS.base(), `${STARTUP_TIMESTAMP}-detailed.log`),
  flow: () => join(DEBUG_PATHS.base(), `${STARTUP_TIMESTAMP}-flow.log`),
  api: () => join(DEBUG_PATHS.base(), `${STARTUP_TIMESTAMP}-api.log`),
  state: () => join(DEBUG_PATHS.base(), `${STARTUP_TIMESTAMP}-state.log`),
  llm: () => join(process.cwd(), 'output', 'llm.log'),
}

export const CORINT_LOG_DIR = CORINT_DIR
