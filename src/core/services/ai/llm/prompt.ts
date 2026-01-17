import type {
  MessageParam,
  TextBlockParam,
} from '@anthropic-ai/sdk/resources/index.mjs'
import type { AssistantMessage, UserMessage } from '@query'

export const PROMPT_CACHING_ENABLED = !process.env.DISABLE_PROMPT_CACHING

export function applyCacheControlWithLimits(
  systemBlocks: TextBlockParam[],
  messageParams: MessageParam[],
): { systemBlocks: TextBlockParam[]; messageParams: MessageParam[] } {
  if (!PROMPT_CACHING_ENABLED) {
    return { systemBlocks, messageParams }
  }

  const maxCacheBlocks = 4
  let usedCacheBlocks = 0

  const processedSystemBlocks = systemBlocks.map(block => {
    if (usedCacheBlocks < maxCacheBlocks && block.text.length > 1000) {
      usedCacheBlocks++
      return {
        ...block,
        cache_control: { type: 'ephemeral' as const },
      }
    }
    const { cache_control, ...blockWithoutCache } = block
    return blockWithoutCache
  })

  const processedMessageParams = messageParams.map((message, messageIndex) => {
    if (Array.isArray(message.content)) {
      const processedContent = message.content.map(
        (contentBlock, blockIndex) => {
          const shouldCache =
            usedCacheBlocks < maxCacheBlocks &&
            contentBlock.type === 'text' &&
            typeof contentBlock.text === 'string' &&
            (contentBlock.text.length > 2000 ||
              (messageIndex === messageParams.length - 1 &&
                blockIndex === message.content.length - 1 &&
                contentBlock.text.length > 500))

          if (shouldCache) {
            usedCacheBlocks++
            return {
              ...contentBlock,
              cache_control: { type: 'ephemeral' as const },
            }
          }

          const { cache_control, ...blockWithoutCache } = contentBlock as any
          return blockWithoutCache
        },
      )

      return {
        ...message,
        content: processedContent,
      }
    }

    return message
  })

  return {
    systemBlocks: processedSystemBlocks,
    messageParams: processedMessageParams,
  }
}

export function userMessageToMessageParam(
  message: UserMessage,
  addCache = false,
): MessageParam {
  if (addCache) {
    if (typeof message.message.content === 'string') {
      return {
        role: 'user',
        content: [
          {
            type: 'text',
            text: message.message.content,
          },
        ],
      }
    } else {
      return {
        role: 'user',
        content: message.message.content.map(_ => ({ ..._ })),
      }
    }
  }
  return {
    role: 'user',
    content: message.message.content,
  }
}

export function assistantMessageToMessageParam(
  message: AssistantMessage,
  addCache = false,
): MessageParam {
  if (addCache) {
    if (typeof message.message.content === 'string') {
      return {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: message.message.content,
          },
        ],
      }
    } else {
      return {
        role: 'assistant',
        content: message.message.content.map(_ => ({ ..._ })),
      }
    }
  }
  return {
    role: 'assistant',
    content: message.message.content,
  }
}

export function splitSysPromptPrefix(systemPrompt: string[]): string[] {
  const systemPromptFirstBlock = systemPrompt[0] || ''
  const systemPromptRest = systemPrompt.slice(1)
  return [systemPromptFirstBlock, systemPromptRest.join('\n')].filter(Boolean)
}

export function addCacheBreakpoints(
  messages: (UserMessage | AssistantMessage)[],
): MessageParam[] {
  return messages.map((msg, index) => {
    return msg.type === 'user'
      ? userMessageToMessageParam(msg, index > messages.length - 3)
      : assistantMessageToMessageParam(msg, index > messages.length - 3)
  })
}
