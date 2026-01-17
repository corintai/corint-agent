import 'dotenv/config'

export { generateKodeContext, refreshKodeContext } from '@services/kodeContext'
export { formatSystemPromptWithContext } from '@services/systemPrompt'

export {
  API_ERROR_MESSAGE_PREFIX,
  PROMPT_TOO_LONG_ERROR_MESSAGE,
  CREDIT_BALANCE_TOO_LOW_ERROR_MESSAGE,
  INVALID_API_KEY_ERROR_MESSAGE,
  NO_CONTENT_MESSAGE,
  MAIN_QUERY_TEMPERATURE,
} from './llmConstants'

export {
  fetchAnthropicModels,
  getAnthropicClient,
  resetAnthropicClient,
  verifyApiKey,
} from './llm/anthropic'

export {
  assistantMessageToMessageParam,
  userMessageToMessageParam,
} from './llm/prompt'

export { queryLLM, queryModel, queryQuick } from './llm/query'
