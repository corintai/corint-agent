export enum LogLevel {
  TRACE = 'TRACE',
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  FLOW = 'FLOW',
  API = 'API',
  STATE = 'STATE',
  REMINDER = 'REMINDER',
}

export interface LogEntry {
  timestamp: string
  level: LogLevel
  phase: string
  requestId?: string
  data: any
  elapsed?: number
}

export interface ErrorDiagnosis {
  errorType: string
  category:
    | 'NETWORK'
    | 'API'
    | 'PERMISSION'
    | 'CONFIG'
    | 'SYSTEM'
    | 'USER_INPUT'
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  description: string
  suggestions: string[]
  debugSteps: string[]
  relatedLogs?: string[]
}
