import { appendFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import chalk from 'chalk'
import { DEBUG_PATHS } from './constants'
import { isDebugMode } from './flags'
import { terminalLog } from './terminal'

function writeLLMLogToFile(context: {
  systemPrompt: string
  messages: any[]
  response: any
  usage?: { inputTokens: number; outputTokens: number }
  timing: { start: number; end: number }
  apiFormat?: 'anthropic' | 'openai'
}) {
  try {
    const llmLogPath = DEBUG_PATHS.llm()
    const outputDir = join(process.cwd(), 'output')

    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true })
    }

    const duration = context.timing.end - context.timing.start
    const timestamp = new Date().toISOString()

    const separator = '='.repeat(80)
    const subSeparator = '-'.repeat(60)

    let logContent = `\n${separator}\n`
    logContent += `[${timestamp}] LLM Interaction (${context.apiFormat || 'unknown'} API)\n`
    logContent += `Duration: ${duration}ms`
    if (context.usage) {
      logContent += ` | Tokens: ${context.usage.inputTokens} in → ${context.usage.outputTokens} out`
    }
    logContent += `\n${separator}\n\n`

    // System Prompt
    logContent += `${subSeparator}\n`
    logContent += `SYSTEM PROMPT (${context.systemPrompt.length} chars):\n`
    logContent += `${subSeparator}\n`
    logContent += `${context.systemPrompt}\n\n`

    // Messages
    logContent += `${subSeparator}\n`
    logContent += `MESSAGES (${context.messages.length} total):\n`
    logContent += `${subSeparator}\n`

    context.messages.forEach((msg, index) => {
      const role = (msg.role || 'unknown').toUpperCase()
      logContent += `\n[${index}] ${role}:\n`

      if (typeof msg.content === 'string') {
        logContent += `${msg.content}\n`
      } else if (Array.isArray(msg.content)) {
        msg.content.forEach((block: any, blockIndex: number) => {
          if (block.type === 'text') {
            logContent += `  [text] ${block.text}\n`
          } else if (block.type === 'tool_use') {
            logContent += `  [tool_use] ${block.name}: ${JSON.stringify(block.input, null, 2)}\n`
          } else if (block.type === 'tool_result') {
            const resultContent =
              typeof block.content === 'string'
                ? block.content
                : JSON.stringify(block.content, null, 2)
            logContent += `  [tool_result] tool_use_id=${block.tool_use_id}:\n${resultContent}\n`
          } else {
            logContent += `  [${block.type || 'unknown'}] ${JSON.stringify(block, null, 2)}\n`
          }
        })
      } else if (msg.content) {
        logContent += `${JSON.stringify(msg.content, null, 2)}\n`
      }

      // Handle OpenAI tool_calls format
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        logContent += `  [tool_calls]:\n`
        msg.tool_calls.forEach((tc: any, tcIndex: number) => {
          logContent += `    [${tcIndex}] ${tc.function?.name || tc.name}: ${tc.function?.arguments || JSON.stringify(tc.input)}\n`
        })
      }
    })

    // Response
    logContent += `\n${subSeparator}\n`
    logContent += `RESPONSE:\n`
    logContent += `${subSeparator}\n`

    let responseContent = context.response
    if (context.response?.content) {
      responseContent = context.response.content
    } else if (context.response?.message?.content) {
      responseContent = context.response.message.content
    }

    if (Array.isArray(responseContent)) {
      responseContent.forEach((block: any, index: number) => {
        if (block.type === 'text') {
          logContent += `[text] ${block.text}\n`
        } else if (block.type === 'tool_use') {
          logContent += `[tool_use] ${block.name} (id: ${block.id}):\n${JSON.stringify(block.input, null, 2)}\n`
        } else if (block.type === 'thinking') {
          logContent += `[thinking] ${block.thinking}\n`
        } else {
          logContent += `[${block.type || 'unknown'}] ${JSON.stringify(block, null, 2)}\n`
        }
      })
    } else if (typeof responseContent === 'string') {
      logContent += `${responseContent}\n`
    } else {
      logContent += `${JSON.stringify(responseContent, null, 2)}\n`
    }

    logContent += `\nStop Reason: ${context.response?.stop_reason || context.response?.finish_reason || 'unknown'}\n`
    logContent += `${separator}\n`

    appendFileSync(llmLogPath, logContent)
  } catch (error) {
    // Silently fail to avoid disrupting the main flow
  }
}

export function logLLMInteraction(context: {
  systemPrompt: string
  messages: any[]
  response: any
  usage?: { inputTokens: number; outputTokens: number }
  timing: { start: number; end: number }
  apiFormat?: 'anthropic' | 'openai'
}) {
  // Always write to llm.log file regardless of debug mode
  writeLLMLogToFile(context)

  if (!isDebugMode()) return

  const duration = context.timing.end - context.timing.start

  terminalLog('\n' + chalk.blue('🧠 LLM CALL DEBUG'))
  terminalLog(chalk.gray('━'.repeat(60)))

  terminalLog(chalk.yellow('📊 Context Overview:'))
  terminalLog(`   Messages Count: ${context.messages.length}`)
  terminalLog(`   System Prompt Length: ${context.systemPrompt.length} chars`)
  terminalLog(`   Duration: ${duration.toFixed(0)}ms`)

  if (context.usage) {
    terminalLog(
      `   Token Usage: ${context.usage.inputTokens} → ${context.usage.outputTokens}`,
    )
  }

  const apiLabel = context.apiFormat
    ? ` (${context.apiFormat.toUpperCase()})`
    : ''
  terminalLog(chalk.cyan(`\n💬 Real API Messages${apiLabel} (last 10):`))

  const recentMessages = context.messages.slice(-10)
  recentMessages.forEach((msg, index) => {
    const globalIndex = context.messages.length - recentMessages.length + index
    const roleColor =
      msg.role === 'user'
        ? 'green'
        : msg.role === 'assistant'
          ? 'blue'
          : msg.role === 'system'
            ? 'yellow'
            : 'gray'

    let content = ''
    let isReminder = false

    if (typeof msg.content === 'string') {
      if (msg.content.includes('<system-reminder>')) {
        isReminder = true
        const reminderContent = msg.content
          .replace(/<\/?system-reminder>/g, '')
          .trim()
        content = `🔔 ${reminderContent.length > 800 ? reminderContent.substring(0, 800) + '...' : reminderContent}`
      } else {
        const maxLength =
          msg.role === 'user' ? 1000 : msg.role === 'system' ? 1200 : 800
        content =
          msg.content.length > maxLength
            ? msg.content.substring(0, maxLength) + '...'
            : msg.content
      }
    } else if (Array.isArray(msg.content)) {
      const textBlocks = msg.content.filter(
        (block: any) => block.type === 'text',
      )
      const toolBlocks = msg.content.filter(
        (block: any) => block.type === 'tool_use',
      )
      if (textBlocks.length > 0) {
        const text = textBlocks[0].text || ''
        const maxLength = msg.role === 'assistant' ? 1000 : 800
        content =
          text.length > maxLength ? text.substring(0, maxLength) + '...' : text
      }
      if (toolBlocks.length > 0) {
        content += ` [+ ${toolBlocks.length} tool calls]`
      }
      if (textBlocks.length === 0 && toolBlocks.length === 0) {
        content = `[${msg.content.length} blocks: ${msg.content.map(b => b.type || 'unknown').join(', ')}]`
      }
    } else {
      content = '[complex_content]'
    }

    if (isReminder) {
      terminalLog(
        `   [${globalIndex}] ${chalk.magenta('🔔 REMINDER')}: ${chalk.dim(content)}`,
      )
    } else {
      const roleIcon =
        msg.role === 'user'
          ? '👤'
          : msg.role === 'assistant'
            ? '🤖'
            : msg.role === 'system'
              ? '⚙️'
              : '📄'
      terminalLog(
        `   [${globalIndex}] ${(chalk as any)[roleColor](roleIcon + ' ' + msg.role.toUpperCase())}: ${content}`,
      )
    }

    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      const toolCalls = msg.content.filter(
        (block: any) => block.type === 'tool_use',
      )
      if (toolCalls.length > 0) {
        terminalLog(
          chalk.cyan(
            `       🔧 → Tool calls (${toolCalls.length}): ${toolCalls.map((t: any) => t.name).join(', ')}`,
          ),
        )
        toolCalls.forEach((tool: any, idx: number) => {
          const inputStr = JSON.stringify(tool.input || {})
          const maxLength = 200
          const displayInput =
            inputStr.length > maxLength
              ? inputStr.substring(0, maxLength) + '...'
              : inputStr
          terminalLog(
            chalk.dim(`         [${idx}] ${tool.name}: ${displayInput}`),
          )
        })
      }
    }
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      terminalLog(
        chalk.cyan(
          `       🔧 → Tool calls (${msg.tool_calls.length}): ${msg.tool_calls.map((t: any) => t.function.name).join(', ')}`,
        ),
      )
      msg.tool_calls.forEach((tool: any, idx: number) => {
        const inputStr = tool.function.arguments || '{}'
        const maxLength = 200
        const displayInput =
          inputStr.length > maxLength
            ? inputStr.substring(0, maxLength) + '...'
            : inputStr
        terminalLog(
          chalk.dim(`         [${idx}] ${tool.function.name}: ${displayInput}`),
        )
      })
    }
  })

  terminalLog(chalk.magenta('\n🤖 LLM Response:'))

  let responseContent = ''
  let toolCalls: any[] = []

  if (Array.isArray(context.response.content)) {
    const textBlocks = context.response.content.filter(
      (block: any) => block.type === 'text',
    )
    responseContent = textBlocks.length > 0 ? textBlocks[0].text || '' : ''
    toolCalls = context.response.content.filter(
      (block: any) => block.type === 'tool_use',
    )
  } else if (typeof context.response.content === 'string') {
    responseContent = context.response.content
    toolCalls = context.response.tool_calls || context.response.toolCalls || []
  } else if (context.response.message?.content) {
    if (Array.isArray(context.response.message.content)) {
      const textBlocks = context.response.message.content.filter(
        (block: any) => block.type === 'text',
      )
      responseContent = textBlocks.length > 0 ? textBlocks[0].text || '' : ''
      toolCalls = context.response.message.content.filter(
        (block: any) => block.type === 'tool_use',
      )
    } else if (typeof context.response.message.content === 'string') {
      responseContent = context.response.message.content
    }
  } else {
    responseContent = JSON.stringify(
      context.response.content || context.response || '',
    )
  }

  const maxResponseLength = 1000
  const displayContent =
    responseContent.length > maxResponseLength
      ? responseContent.substring(0, maxResponseLength) + '...'
      : responseContent
  terminalLog(`   Content: ${displayContent}`)

  if (toolCalls.length > 0) {
    const toolNames = toolCalls.map(
      (t: any) => t.name || t.function?.name || 'unknown',
    )
    terminalLog(
      chalk.cyan(
        `   🔧 Tool Calls (${toolCalls.length}): ${toolNames.join(', ')}`,
      ),
    )
    toolCalls.forEach((tool: any, index: number) => {
      const toolName = tool.name || tool.function?.name || 'unknown'
      const toolInput = tool.input || tool.function?.arguments || '{}'
      const inputStr =
        typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput)
      const maxToolInputLength = 300
      const displayInput =
        inputStr.length > maxToolInputLength
          ? inputStr.substring(0, maxToolInputLength) + '...'
          : inputStr
      terminalLog(chalk.dim(`     [${index}] ${toolName}: ${displayInput}`))
    })
  }

  terminalLog(
    `   Stop Reason: ${context.response.stop_reason || context.response.finish_reason || 'unknown'}`,
  )
  terminalLog(chalk.gray('━'.repeat(60)))
}
