import { format } from 'node:util'
import chalk from 'chalk'
import {
  DEBUG_VERBOSE_TERMINAL_LOG_LEVELS,
  TERMINAL_LOG_LEVELS,
} from './constants'
import { isDebugMode, isDebugVerboseMode } from './flags'
import type { LogEntry } from './types'
import { LogLevel } from './types'

export function terminalLog(...args: unknown[]): void {
  process.stderr.write(`${format(...args)}\n`)
}

function formatMessages(messages: any): string {
  if (Array.isArray(messages)) {
    const recentMessages = messages.slice(-5)
    return recentMessages
      .map((msg, index) => {
        const role = msg.role || 'unknown'
        let content = ''

        if (typeof msg.content === 'string') {
          content =
            msg.content.length > 300
              ? msg.content.substring(0, 300) + '...'
              : msg.content
        } else if (typeof msg.content === 'object') {
          content = '[complex_content]'
        } else {
          content = String(msg.content || '')
        }

        const totalIndex = messages.length - recentMessages.length + index
        return `[${totalIndex}] ${chalk.dim(role)}: ${content}`
      })
      .join('\n    ')
  }

  if (typeof messages === 'string') {
    try {
      const parsed = JSON.parse(messages)
      if (Array.isArray(parsed)) {
        return formatMessages(parsed)
      }
    } catch {}
  }

  if (typeof messages === 'string' && messages.length > 200) {
    return messages.substring(0, 200) + '...'
  }

  return typeof messages === 'string' ? messages : JSON.stringify(messages)
}

function shouldShowInTerminal(level: LogLevel): boolean {
  if (!isDebugMode()) return false

  if (isDebugVerboseMode()) {
    return DEBUG_VERBOSE_TERMINAL_LOG_LEVELS.has(level)
  }

  return TERMINAL_LOG_LEVELS.has(level)
}

export function logToTerminal(entry: LogEntry) {
  if (!shouldShowInTerminal(entry.level)) return

  const { level, phase, data, requestId, elapsed } = entry
  const timestamp = new Date().toISOString().slice(11, 23)

  let prefix = ''
  let color = chalk.gray

  switch (level) {
    case LogLevel.FLOW:
      prefix = '🔄'
      color = chalk.cyan
      break
    case LogLevel.API:
      prefix = '🌐'
      color = chalk.yellow
      break
    case LogLevel.STATE:
      prefix = '📊'
      color = chalk.blue
      break
    case LogLevel.ERROR:
      prefix = '❌'
      color = chalk.red
      break
    case LogLevel.WARN:
      prefix = '⚠️'
      color = chalk.yellow
      break
    case LogLevel.INFO:
      prefix = 'ℹ️'
      color = chalk.green
      break
    case LogLevel.TRACE:
      prefix = '📈'
      color = chalk.magenta
      break
    default:
      prefix = '🔍'
      color = chalk.gray
  }

  const reqId = requestId ? chalk.dim(`[${requestId}]`) : ''
  const elapsedStr = elapsed !== undefined ? chalk.dim(`+${elapsed}ms`) : ''

  let dataStr = ''
  if (typeof data === 'object' && data !== null) {
    if (data.messages) {
      const formattedMessages = formatMessages(data.messages)
      dataStr = JSON.stringify(
        {
          ...data,
          messages: `\n    ${formattedMessages}`,
        },
        null,
        2,
      )
    } else {
      dataStr = JSON.stringify(data, null, 2)
    }
  } else {
    dataStr = typeof data === 'string' ? data : JSON.stringify(data)
  }

  terminalLog(
    `${color(`[${timestamp}]`)} ${prefix} ${color(phase)} ${reqId} ${dataStr} ${elapsedStr}`,
  )
}
