import type { AssistantMessage } from '@query'
import { createAssistantAPIErrorMessage } from '@utils/messages'
import { debug as debugLogger } from '@utils/log/debugLogger'
import {
  API_ERROR_MESSAGE_PREFIX,
  CREDIT_BALANCE_TOO_LOW_ERROR_MESSAGE,
  INVALID_API_KEY_ERROR_MESSAGE,
  PROMPT_TOO_LONG_ERROR_MESSAGE,
} from '../llmConstants'

export function isGPT5Model(modelName: string): boolean {
  return modelName.startsWith('gpt-5')
}

export function getMaxTokensFromProfile(modelProfile: any): number {
  return modelProfile?.maxTokens || 8000
}

export function getAssistantMessageFromError(error: unknown): AssistantMessage {
  if (error instanceof Error && error.message.includes('prompt is too long')) {
    return createAssistantAPIErrorMessage(PROMPT_TOO_LONG_ERROR_MESSAGE)
  }
  if (
    error instanceof Error &&
    error.message.includes('Your credit balance is too low')
  ) {
    return createAssistantAPIErrorMessage(CREDIT_BALANCE_TOO_LOW_ERROR_MESSAGE)
  }
  if (
    error instanceof Error &&
    error.message.toLowerCase().includes('x-api-key')
  ) {
    return createAssistantAPIErrorMessage(INVALID_API_KEY_ERROR_MESSAGE)
  }
  if (error instanceof Error) {
    if (process.env.NODE_ENV === 'development') {
      debugLogger.error('ANTHROPIC_API_ERROR', {
        message: error.message,
        stack: error.stack,
      })
    }
    return createAssistantAPIErrorMessage(
      `${API_ERROR_MESSAGE_PREFIX}: ${error.message}`,
    )
  }
  return createAssistantAPIErrorMessage(API_ERROR_MESSAGE_PREFIX)
}
