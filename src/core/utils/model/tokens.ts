import { Message } from '@query'
import { SYNTHETIC_ASSISTANT_MESSAGES } from '@utils/messages'

/**
 * Normalized token usage structure with consistent field names
 */
export interface NormalizedTokenUsage {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
  prompt_tokens?: number
  completion_tokens?: number
}

/**
 * Normalizes token usage from various API response formats into a consistent structure.
 * Handles differences between Anthropic, OpenAI, and other provider response formats.
 * @param usage - Raw usage object from API response
 * @returns Normalized usage with consistent field names
 */
export function normalizeTokenUsage(usage?: Record<string, unknown>): NormalizedTokenUsage {
  if (!usage) {
    return {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    }
  }

  const inputTokens =
    (usage.input_tokens as number) ??
    (usage.prompt_tokens as number) ??
    (usage.inputTokens as number) ??
    (usage.promptTokens as number) ??
    0

  const outputTokens =
    (usage.output_tokens as number) ??
    (usage.completion_tokens as number) ??
    (usage.outputTokens as number) ??
    (usage.completionTokens as number) ??
    0

  const cacheReadInputTokens =
    (usage.cache_read_input_tokens as number) ??
    ((usage.prompt_token_details as Record<string, unknown>)?.cached_tokens as number) ??
    (usage.cacheReadInputTokens as number) ??
    0

  const cacheCreationInputTokens =
    (usage.cache_creation_input_tokens as number) ??
    (usage.cacheCreatedInputTokens as number) ??
    (usage.cacheCreationInputTokens as number) ??
    0

  return {
    ...usage,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_input_tokens: cacheReadInputTokens,
    cache_creation_input_tokens: cacheCreationInputTokens,
    prompt_tokens: inputTokens,
    completion_tokens: outputTokens,
  } as NormalizedTokenUsage
}

export function countTokens(messages: Message[]): number {
  let i = messages.length - 1
  while (i >= 0) {
    const message = messages[i]
    if (
      message?.type === 'assistant' &&
      'usage' in message.message &&
      !(
        message.message.content[0]?.type === 'text' &&
        SYNTHETIC_ASSISTANT_MESSAGES.has(message.message.content[0].text)
      )
    ) {
      const { usage } = message.message
      return (
        usage.input_tokens +
        (usage.cache_creation_input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0) +
        usage.output_tokens
      )
    }
    i--
  }
  return 0
}

export function countCachedTokens(messages: Message[]): number {
  let i = messages.length - 1
  while (i >= 0) {
    const message = messages[i]
    if (message?.type === 'assistant' && 'usage' in message.message) {
      const { usage } = message.message
      return (
        (usage.cache_creation_input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0)
      )
    }
    i--
  }
  return 0
}
