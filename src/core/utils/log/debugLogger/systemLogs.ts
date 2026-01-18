import chalk from 'chalk'
import { isDebugMode } from './flags'
import { terminalLog } from './terminal'

export function logSystemPromptConstruction(construction: {
  basePrompt: string
  kodeContext?: string
  reminders: string[]
  finalPrompt: string
}) {
  if (!isDebugMode()) return

  terminalLog('\n' + chalk.yellow('📝 SYSTEM PROMPT CONSTRUCTION'))
  terminalLog(`   Base Prompt: ${construction.basePrompt.length} chars`)

  if (construction.kodeContext) {
    terminalLog(`   + Kode Context: ${construction.kodeContext.length} chars`)
  }

  if (construction.reminders.length > 0) {
    terminalLog(
      `   + Dynamic Reminders: ${construction.reminders.length} items`,
    )
    construction.reminders.forEach((reminder, index) => {
      terminalLog(chalk.dim(`     [${index}] ${reminder.substring(0, 80)}...`))
    })
  }

  terminalLog(`   = Final Length: ${construction.finalPrompt.length} chars`)
}

export function logContextCompression(compression: {
  beforeMessages: number
  afterMessages: number
  trigger: string
  preservedFiles: string[]
  compressionRatio: number
}) {
  if (!isDebugMode()) return

  terminalLog('\n' + chalk.red('🗜️  CONTEXT COMPRESSION'))
  terminalLog(`   Trigger: ${compression.trigger}`)
  terminalLog(
    `   Messages: ${compression.beforeMessages} → ${compression.afterMessages}`,
  )
  terminalLog(
    `   Compression Ratio: ${(compression.compressionRatio * 100).toFixed(1)}%`,
  )

  if (compression.preservedFiles.length > 0) {
    terminalLog(`   Preserved Files: ${compression.preservedFiles.join(', ')}`)
  }
}

export function logUserFriendly(type: string, data: any, requestId?: string) {
  if (!isDebugMode()) return

  const timestamp = new Date().toLocaleTimeString()
  let message = ''
  let color = chalk.gray
  let icon = '•'

  switch (type) {
    case 'SESSION_START':
      icon = '🚀'
      color = chalk.green
      message = `Session started with ${data.model || 'default model'}`
      break
    case 'QUERY_START':
      icon = '💭'
      color = chalk.blue
      message = `Processing query: "${data.query?.substring(0, 50)}${data.query?.length > 50 ? '...' : ''}"`
      break
    case 'QUERY_PROGRESS':
      icon = '⏳'
      color = chalk.yellow
      message = `${data.phase} (${data.elapsed}ms)`
      break
    case 'QUERY_COMPLETE':
      icon = '✅'
      color = chalk.green
      message = `Query completed in ${data.duration}ms - Cost: $${data.cost} - ${data.tokens} tokens`
      break
    case 'TOOL_EXECUTION':
      icon = '🔧'
      color = chalk.cyan
      message = `${data.toolName}: ${data.action} ${data.target ? '→ ' + data.target : ''}`
      break
    case 'ERROR_OCCURRED':
      icon = '❌'
      color = chalk.red
      message = `${data.error} ${data.context ? '(' + data.context + ')' : ''}`
      break
    case 'PERFORMANCE_SUMMARY':
      icon = '📊'
      color = chalk.magenta
      message = `Session: ${data.queries} queries, $${data.totalCost}, ${data.avgResponseTime}ms avg`
      break
    default:
      message = JSON.stringify(data)
  }

  const reqId = requestId ? chalk.dim(`[${requestId.slice(0, 8)}]`) : ''
  terminalLog(`${color(`[${timestamp}]`)} ${icon} ${color(message)} ${reqId}`)
}
