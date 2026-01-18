import { ProxyAgent, fetch } from 'undici'
import { getGlobalConfig } from '@utils/config'

export async function callGPT5ResponsesAPI(
  modelProfile: any,
  request: any,
  signal?: AbortSignal,
): Promise<any> {
  const baseURL = modelProfile?.baseURL || 'https://api.openai.com/v1'
  const apiKey = modelProfile?.apiKey
  const proxy = getGlobalConfig().proxy
    ? new ProxyAgent(getGlobalConfig().proxy)
    : undefined

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }

  const responsesParams = request

  try {
    const response = await fetch(`${baseURL}/responses`, {
      method: 'POST',
      headers,
      body: JSON.stringify(responsesParams),
      dispatcher: proxy,
      signal: signal,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(
        `GPT-5 Responses API error: ${response.status} ${response.statusText} - ${errorText}`,
      )
    }

    return response
  } catch (error) {
    if (signal?.aborted) {
      throw new Error('Request cancelled by user')
    }
    throw error
  }
}

function convertResponsesAPIToChatCompletion(responsesData: any): any {
  let outputText = responsesData.output_text || ''
  const usage = responsesData.usage || {}

  if (responsesData.output && Array.isArray(responsesData.output)) {
    const reasoningItems = responsesData.output.filter(
      item => item.type === 'reasoning' && item.summary,
    )
    const messageItems = responsesData.output.filter(
      item => item.type === 'message',
    )

    if (reasoningItems.length > 0 && messageItems.length > 0) {
      const reasoningSummary = reasoningItems
        .map(item => item.summary?.map(s => s.text).join('\n'))
        .filter(Boolean)
        .join('\n\n')

      const mainContent = messageItems
        .map(item => item.content?.map(c => c.text).join('\n'))
        .filter(Boolean)
        .join('\n\n')

      if (reasoningSummary) {
        outputText = `**🧠 Reasoning Process:**\n${reasoningSummary}\n\n**📝 Response:**\n${mainContent}`
      } else {
        outputText = mainContent
      }
    }
  }

  return {
    id: responsesData.id || `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: responsesData.model || '',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: outputText,
          ...(responsesData.reasoning && {
            reasoning: {
              effort: responsesData.reasoning.effort,
              summary: responsesData.reasoning.summary,
            },
          }),
        },
        finish_reason: responsesData.status === 'completed' ? 'stop' : 'length',
      },
    ],
    usage: {
      prompt_tokens: usage.input_tokens || 0,
      completion_tokens: usage.output_tokens || 0,
      total_tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
      prompt_tokens_details: {
        cached_tokens: usage.input_tokens_details?.cached_tokens || 0,
      },
      completion_tokens_details: {
        reasoning_tokens: usage.output_tokens_details?.reasoning_tokens || 0,
      },
    },
  }
}
