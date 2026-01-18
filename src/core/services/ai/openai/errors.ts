import type { OpenAI } from 'openai'
import { getSessionState, setSessionState } from '@utils/session/sessionState'
import { debug as debugLogger } from '@utils/log/debugLogger'

export enum ModelErrorType {
  MaxLength = '1024',
  MaxCompletionTokens = 'max_completion_tokens',
  TemperatureRestriction = 'temperature_restriction',
  StreamOptions = 'stream_options',
  Citations = 'citations',
  RateLimit = 'rate_limit',
}

function getModelErrorKey(
  baseURL: string,
  model: string,
  type: ModelErrorType,
): string {
  return `${baseURL}:${model}:${type}`
}

export function hasModelError(
  baseURL: string,
  model: string,
  type: ModelErrorType,
): boolean {
  return !!getSessionState('modelErrors')[
    getModelErrorKey(baseURL, model, type)
  ]
}

export function setModelError(
  baseURL: string,
  model: string,
  type: ModelErrorType,
  error: string,
) {
  setSessionState('modelErrors', {
    [getModelErrorKey(baseURL, model, type)]: error,
  })
}

type ErrorDetector = (errMsg: string) => boolean
type ErrorFixer = (
  opts: OpenAI.ChatCompletionCreateParams,
) => Promise<void> | void
export interface ErrorHandler {
  type: ModelErrorType
  detect: ErrorDetector
  fix: ErrorFixer
}

export const GPT5_ERROR_HANDLERS: ErrorHandler[] = [
  {
    type: ModelErrorType.MaxCompletionTokens,
    detect: errMsg => {
      const lowerMsg = errMsg.toLowerCase()
      return (
        (lowerMsg.includes("unsupported parameter: 'max_tokens'") &&
          lowerMsg.includes("'max_completion_tokens'")) ||
        (lowerMsg.includes('max_tokens') &&
          lowerMsg.includes('max_completion_tokens')) ||
        (lowerMsg.includes('max_tokens') &&
          lowerMsg.includes('not supported')) ||
        (lowerMsg.includes('max_tokens') &&
          lowerMsg.includes('use max_completion_tokens')) ||
        (lowerMsg.includes('invalid parameter') &&
          lowerMsg.includes('max_tokens')) ||
        (lowerMsg.includes('parameter error') &&
          lowerMsg.includes('max_tokens'))
      )
    },
    fix: async opts => {
      debugLogger.api('GPT5_FIX_MAX_TOKENS', {
        from: opts.max_tokens,
        to: opts.max_tokens,
      })
      if ('max_tokens' in opts) {
        opts.max_completion_tokens = opts.max_tokens
        delete opts.max_tokens
      }
    },
  },
  {
    type: ModelErrorType.TemperatureRestriction,
    detect: errMsg => {
      const lowerMsg = errMsg.toLowerCase()
      return (
        lowerMsg.includes('temperature') &&
        (lowerMsg.includes('only supports') ||
          lowerMsg.includes('must be 1') ||
          lowerMsg.includes('invalid temperature'))
      )
    },
    fix: async opts => {
      debugLogger.api('GPT5_FIX_TEMPERATURE', {
        from: opts.temperature,
        to: 1,
      })
      opts.temperature = 1
    },
  },
]

export const ERROR_HANDLERS: ErrorHandler[] = [
  {
    type: ModelErrorType.MaxLength,
    detect: errMsg =>
      errMsg.includes('Expected a string with maximum length 1024'),
    fix: async opts => {
      const toolDescriptions = {}
      for (const tool of opts.tools || []) {
        if (tool.function.description.length <= 1024) continue
        let str = ''
        let remainder = ''
        for (let line of tool.function.description.split('\n')) {
          if (str.length + line.length < 1024) {
            str += line + '\n'
          } else {
            remainder += line + '\n'
          }
        }

        tool.function.description = str
        toolDescriptions[tool.function.name] = remainder
      }
      if (Object.keys(toolDescriptions).length > 0) {
        let content = '<additional-tool-usage-instructions>\n\n'
        for (const [name, description] of Object.entries(toolDescriptions)) {
          content += `<${name}>\n${description}\n</${name}>\n\n`
        }
        content += '</additional-tool-usage-instructions>'

        for (let i = opts.messages.length - 1; i >= 0; i--) {
          if (opts.messages[i].role === 'system') {
            opts.messages.splice(i + 1, 0, {
              role: 'system',
              content,
            })
            break
          }
        }
      }
    },
  },
  {
    type: ModelErrorType.MaxCompletionTokens,
    detect: errMsg => errMsg.includes("Use 'max_completion_tokens'"),
    fix: async opts => {
      opts.max_completion_tokens = opts.max_tokens
      delete opts.max_tokens
    },
  },
  {
    type: ModelErrorType.StreamOptions,
    detect: errMsg => errMsg.includes('stream_options'),
    fix: async opts => {
      delete opts.stream_options
    },
  },
  {
    type: ModelErrorType.Citations,
    detect: errMsg =>
      errMsg.includes('Extra inputs are not permitted') &&
      errMsg.includes('citations'),
    fix: async opts => {
      if (!opts.messages) return

      for (const message of opts.messages) {
        if (!message) continue

        if (Array.isArray(message.content)) {
          for (const item of message.content) {
            if (item && typeof item === 'object') {
              const itemObj = item as unknown as Record<string, unknown>
              if ('citations' in itemObj) {
                delete itemObj.citations
              }
            }
          }
        } else if (message.content && typeof message.content === 'object') {
          const contentObj = message.content as unknown as Record<
            string,
            unknown
          >
          if ('citations' in contentObj) {
            delete contentObj.citations
          }
        }
      }
    },
  },
]

export function isRateLimitError(errMsg: string): boolean {
  if (!errMsg) return false
  const lowerMsg = errMsg.toLowerCase()
  return (
    lowerMsg.includes('rate limit') ||
    lowerMsg.includes('too many requests') ||
    lowerMsg.includes('429')
  )
}
