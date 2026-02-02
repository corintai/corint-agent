import { randomUUID } from 'crypto'
import type { Tool } from '@tool'
import type { Message, UserMessage } from '@query'
import type { UUID } from '@kode-types/common'
import { queryLLM } from '@services/llmLazy'
import { debug } from '@utils/log/debugLogger'
import {
  CORE_TOOLS,
  TOOL_CATEGORIES,
  type ToolCategory,
  getCategoryDescription,
} from './toolCategories'

interface ToolSelectionResult {
  selectedTools: Tool[]
  selectedCategories: ToolCategory[]
  reasoning?: string
}

/**
 * Extract text content from a message
 */
function extractTextContent(message: Message): string {
  const payload =
    message.type === 'progress' ? message.content.message : message.message

  if (!payload?.content) return ''

  if (typeof payload.content === 'string') {
    return payload.content
  }

  if (Array.isArray(payload.content)) {
    const textBlocks = payload.content.filter((b: any) => b.type === 'text')
    return textBlocks.map((b: any) => b.text || '').join('\n')
  }

  return ''
}

/**
 * Use quick model to intelligently select which optional tools to include
 */
export async function selectToolsForRequest(
  messages: Message[],
  allTools: Tool[],
  abortSignal: AbortSignal,
): Promise<ToolSelectionResult> {
  const startTime = Date.now()

  // Separate core and optional tools
  const coreTools = allTools.filter(t => CORE_TOOLS.includes(t.name))
  const optionalTools = allTools.filter(t => !CORE_TOOLS.includes(t.name))

  // Extract recent conversation context (last 3 rounds = 6 messages)
  const recentMessages = messages.slice(-6)
  const conversationContext = recentMessages
    .map(m => {
      const role = m.type === 'user' ? 'User' : 'Assistant'
      const content = extractTextContent(m)
      // Remove system-reminder tags
      const cleanContent = content.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim()
      return cleanContent ? `${role}: ${cleanContent}` : ''
    })
    .filter(line => line)
    .join('\n')

  // Build category summary for quick model
  const categoryEntries = Object.entries(TOOL_CATEGORIES) as Array<
    [ToolCategory, readonly string[]]
  >
  const categorySummary = categoryEntries.map(([category, tools]) => ({
    category,
    description: getCategoryDescription(category),
    toolCount: tools.length,
    examples: tools.slice(0, 3).join(', '),
  }))

  const prompt = `Analyze the conversation and select which tool categories are needed.

Recent conversation:
${conversationContext}

Available tool categories:
${categorySummary.map(c => `- ${c.category}: ${c.description} (${c.toolCount} tools, e.g., ${c.examples})`).join('\n')}

Instructions:
1. Select ONLY the categories that are clearly needed for this specific request
2. Be conservative - don't select categories unless they're obviously required
3. For simple questions or general conversation, select NO categories (empty array)
4. Consider the full conversation context, not just the last message
5. Return JSON format: {"categories": ["category1", "category2"], "reasoning": "brief explanation"}

Examples:
- "你是哪个模型？" → {"categories": [], "reasoning": "Simple question, no tools needed"}
- "查询risk_db中的用户表" → {"categories": ["data"], "reasoning": "Database query needed"}
- "计算特征的IV值" → {"categories": ["credit"], "reasoning": "Credit modeling analysis"}
- "生成特征工程方案" → {"categories": ["feature"], "reasoning": "Feature engineering task"}
- Multi-turn: "User: 帮我分析数据\nAssistant: 哪个数据库？\nUser: risk_db" → {"categories": ["data"], "reasoning": "Database analysis from context"}

Return only valid JSON, no other text.`

  try {
    const selectorMessage: UserMessage = {
      type: 'user',
      uuid: randomUUID() as UUID,
      message: {
        role: 'user',
        content: prompt,
      },
    }

    const response = await queryLLM(
      [selectorMessage],
      ['You are a tool category selector. Analyze user requests and return only JSON.'],
      0,
      [],
      abortSignal,
      {
        model: 'quick',
        prependCLISysprompt: false,
        safeMode: false,
      },
    )

    // Extract content from response
    let content = ''
    const responseContent = response.message?.content
    content =
      typeof responseContent === 'string'
        ? responseContent
        : Array.isArray(responseContent)
          ? responseContent.find((b: any) => b.type === 'text')?.text || '{}'
          : '{}'

    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    const result = jsonMatch ? JSON.parse(jsonMatch[0]) : { categories: [] }

    const selectedCategories = (result.categories || []) as ToolCategory[]
    const reasoning = result.reasoning || 'No reasoning provided'

    // Filter tools by selected categories
    const selectedOptionalTools = optionalTools.filter(tool => {
      const category = categoryEntries.find(([_, tools]) =>
        tools.includes(tool.name),
      )?.[0]
      return category ? selectedCategories.includes(category) : false
    })

    const selectedTools = [...coreTools, ...selectedOptionalTools]

    const duration = Date.now() - startTime

    debug.info('TOOL_SELECTION', {
      conversationLength: recentMessages.length,
      totalTools: allTools.length,
      coreTools: coreTools.length,
      selectedOptionalTools: selectedOptionalTools.length,
      selectedCategories,
      reasoning,
      duration,
    })

    return {
      selectedTools,
      selectedCategories,
      reasoning,
    }
  } catch (error) {
    // Fallback: return all tools if selection fails
    debug.warn('TOOL_SELECTION_FAILED', {
      error: error instanceof Error ? error.message : String(error),
      fallback: 'Using all tools',
    })

    return {
      selectedTools: allTools,
      selectedCategories: Object.keys(TOOL_CATEGORIES) as ToolCategory[],
      reasoning: 'Selection failed, using all tools as fallback',
    }
  }
}
