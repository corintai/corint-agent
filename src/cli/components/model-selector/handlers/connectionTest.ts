import { debug as debugLogger } from '@utils/log/debugLogger'
import type { ProviderType } from '@utils/config'
import { verifyApiKey } from '@services/llmLazy'
import {
  testGPT5Connection,
  validateGPT5Config,
} from '@services/gpt5ConnectionTest'

import { providers } from '@constants/models'
import type { ConnectionTestResult } from '../types'

type ConnectionTestContext = {
  apiKey: string
  customBaseUrl: string
  maxTokens: string
  providerBaseUrl: string
  resourceName: string
  selectedModel: string
  selectedProvider: ProviderType
  setConnectionTestResult: (result: ConnectionTestResult | null) => void
  setIsTestingConnection: (value: boolean) => void
}

export async function runConnectionTest(
  ctx: ConnectionTestContext,
): Promise<ConnectionTestResult> {
  ctx.setIsTestingConnection(true)
  ctx.setConnectionTestResult(null)

  try {
    let testBaseURL =
      ctx.providerBaseUrl || providers[ctx.selectedProvider]?.baseURL || ''

    if (ctx.selectedProvider === 'azure') {
      testBaseURL = `https://${ctx.resourceName}.openai.azure.com/openai/deployments/${ctx.selectedModel}`
    } else if (ctx.selectedProvider === 'custom-openai') {
      testBaseURL = ctx.customBaseUrl
    }

    const isOpenAICompatible = [
      'minimax',
      'kimi',
      'deepseek',
      'siliconflow',
      'qwen',
      'glm',
      'baidu-qianfan',
      'openai',
      'mistral',
      'xai',
      'groq',
      'custom-openai',
    ].includes(ctx.selectedProvider)

    if (isOpenAICompatible) {
      const isGPT5 = ctx.selectedModel?.toLowerCase().includes('gpt-5')

      if (isGPT5) {
        debugLogger.api('GPT5_CONNECTION_TEST_USING_SPECIALIZED', {
          model: ctx.selectedModel,
          provider: ctx.selectedProvider,
        })

        const configValidation = validateGPT5Config({
          model: ctx.selectedModel,
          apiKey: ctx.apiKey,
          baseURL: testBaseURL,
          maxTokens: parseInt(ctx.maxTokens) || 8192,
          provider: ctx.selectedProvider,
        })

        if (!configValidation.valid) {
          return {
            success: false,
            message: '❌ GPT-5 configuration validation failed',
            details: configValidation.errors.join('\n'),
          }
        }

        const gpt5Result = await testGPT5Connection({
          model: ctx.selectedModel,
          apiKey: ctx.apiKey,
          baseURL: testBaseURL,
          maxTokens: parseInt(ctx.maxTokens) || 8192,
          provider: ctx.selectedProvider,
        })

        return gpt5Result
      }

      const endpointsToTry = []

      if (ctx.selectedProvider === 'minimax') {
        endpointsToTry.push(
          {
            path: '/text/chatcompletion_v2',
            name: 'MiniMax v2 (recommended)',
          },
          { path: '/chat/completions', name: 'Standard OpenAI' },
        )
      } else {
        endpointsToTry.push({
          path: '/chat/completions',
          name: 'Standard OpenAI',
        })
      }

      let lastError: ConnectionTestResult | null = null
      for (const endpoint of endpointsToTry) {
        try {
          const testResult = await testChatEndpoint(
            ctx,
            testBaseURL,
            endpoint.path,
            endpoint.name,
          )

          if (testResult.success) {
            return testResult
          }
          lastError = testResult
        } catch (error) {
          lastError = {
            success: false,
            message: `Failed to test ${endpoint.name}`,
            endpoint: endpoint.path,
            details: error instanceof Error ? error.message : String(error),
          }
        }
      }

      return (
        lastError || {
          success: false,
          message: 'All endpoints failed',
          details: 'No endpoints could be reached',
        }
      )
    } else {
      return await testProviderSpecificEndpoint(ctx, testBaseURL)
    }
  } catch (error) {
    return {
      success: false,
      message: 'Connection test failed',
      details: error instanceof Error ? error.message : String(error),
    }
  } finally {
    ctx.setIsTestingConnection(false)
  }
}

async function testChatEndpoint(
  ctx: ConnectionTestContext,
  baseURL: string,
  endpointPath: string,
  endpointName: string,
): Promise<ConnectionTestResult> {
  const testURL = `${baseURL.replace(/\/+$/, '')}${endpointPath}`

  const testPayload: any = {
    model: ctx.selectedModel,
    messages: [
      {
        role: 'user',
        content:
          'Please respond with exactly "YES" (in capital letters) to confirm this connection is working.',
      },
    ],
    max_tokens: Math.max(parseInt(ctx.maxTokens) || 8192, 8192),
    temperature: 0,
    stream: false,
  }

  if (ctx.selectedModel && ctx.selectedModel.toLowerCase().includes('gpt-5')) {
    debugLogger.api('GPT5_PARAMETER_FIX_APPLY', { model: ctx.selectedModel })

    if (testPayload.max_tokens) {
      testPayload.max_completion_tokens = testPayload.max_tokens
      delete testPayload.max_tokens
      debugLogger.api('GPT5_PARAMETER_FIX_MAX_TOKENS', {
        model: ctx.selectedModel,
        max_completion_tokens: testPayload.max_completion_tokens,
      })
    }

    if (
      testPayload.temperature !== undefined &&
      testPayload.temperature !== 1
    ) {
      debugLogger.api('GPT5_PARAMETER_FIX_TEMPERATURE', {
        model: ctx.selectedModel,
        from: testPayload.temperature,
        to: 1,
      })
      testPayload.temperature = 1
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (ctx.selectedProvider === 'azure') {
    headers['api-key'] = ctx.apiKey
  } else {
    headers['Authorization'] = `Bearer ${ctx.apiKey}`
  }

  try {
    const response = await fetch(testURL, {
      method: 'POST',
      headers,
      body: JSON.stringify(testPayload),
    })

    if (response.ok) {
      const data = await response.json()
      debugLogger.api('CONNECTION_TEST_RESPONSE', {
        provider: ctx.selectedProvider,
        endpoint: endpointPath,
        ok: true,
      })

      let responseContent = ''

      if (data.choices && data.choices.length > 0) {
        responseContent = data.choices[0]?.message?.content || ''
      } else if (data.reply) {
        responseContent = data.reply
      } else if (data.output) {
        responseContent = data.output?.text || data.output || ''
      }

      debugLogger.api('CONNECTION_TEST_RESPONSE_PARSED', {
        provider: ctx.selectedProvider,
        endpoint: endpointPath,
        contentLength: responseContent.length,
      })

      const containsYes = responseContent.toLowerCase().includes('yes')

      if (containsYes) {
        return {
          success: true,
          message: `✅ Connection test passed with ${endpointName}`,
          endpoint: endpointPath,
          details: `Model responded correctly: "${responseContent.trim()}"`,
        }
      } else {
        return {
          success: false,
          message: `⚠️ ${endpointName} connected but model response unexpected`,
          endpoint: endpointPath,
          details: `Expected "YES" but got: "${responseContent.trim() || '(empty response)'}"`,
        }
      }
    } else {
      const errorData = await response.json().catch(() => null)
      const errorMessage =
        errorData?.error?.message || errorData?.message || response.statusText

      return {
        success: false,
        message: `❌ ${endpointName} failed (${response.status})`,
        endpoint: endpointPath,
        details: `Error: ${errorMessage}`,
      }
    }
  } catch (error) {
    return {
      success: false,
      message: `❌ ${endpointName} connection failed`,
      endpoint: endpointPath,
      details: error instanceof Error ? error.message : String(error),
    }
  }
}

async function testResponsesEndpoint(
  ctx: ConnectionTestContext,
  baseURL: string,
  endpointPath: string,
  endpointName: string,
): Promise<ConnectionTestResult> {
  const testURL = `${baseURL.replace(/\/+$/, '')}${endpointPath}`

  const testPayload: any = {
    model: ctx.selectedModel,
    input: [
      {
        role: 'user',
        content:
          'Please respond with exactly "YES" (in capital letters) to confirm this connection is working.',
      },
    ],
    max_completion_tokens: Math.max(parseInt(ctx.maxTokens) || 8192, 8192),
    temperature: 1,
    reasoning: {
      effort: 'low',
    },
  }

  debugLogger.api('GPT5_RESPONSES_API_TEST_START', {
    model: ctx.selectedModel,
    url: testURL,
  })

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${ctx.apiKey}`,
  }

  try {
    const response = await fetch(testURL, {
      method: 'POST',
      headers,
      body: JSON.stringify(testPayload),
    })

    if (response.ok) {
      const data = await response.json()
      debugLogger.api('GPT5_RESPONSES_API_TEST_RESPONSE', {
        model: ctx.selectedModel,
        ok: true,
      })

      let responseContent = ''

      if (data.output_text) {
        responseContent = data.output_text
      } else if (data.output) {
        responseContent =
          typeof data.output === 'string' ? data.output : data.output.text || ''
      }

      debugLogger.api('GPT5_RESPONSES_API_TEST_RESPONSE_PARSED', {
        model: ctx.selectedModel,
        contentLength: responseContent.length,
      })

      const containsYes = responseContent.toLowerCase().includes('yes')

      if (containsYes) {
        return {
          success: true,
          message: `✅ Connection test passed with ${endpointName}`,
          endpoint: endpointPath,
          details: `GPT-5 responded correctly via Responses API: "${responseContent.trim()}"`,
        }
      } else {
        return {
          success: false,
          message: `⚠️ ${endpointName} connected but model response unexpected`,
          endpoint: endpointPath,
          details: `Expected "YES" but got: "${responseContent.trim() || '(empty response)'}"`,
        }
      }
    } else {
      const errorData = await response.json().catch(() => null)
      const errorMessage =
        errorData?.error?.message || errorData?.message || response.statusText

      debugLogger.warn('GPT5_RESPONSES_API_TEST_ERROR', {
        model: ctx.selectedModel,
        status: response.status,
        error:
          errorData?.error?.message ||
          errorData?.message ||
          response.statusText,
      })

      let details = `Responses API Error: ${errorMessage}`
      if (response.status === 400 && errorMessage.includes('max_tokens')) {
        details +=
          '\n🔧 Note: This appears to be a parameter compatibility issue. The fallback to Chat Completions should handle this.'
      } else if (response.status === 404) {
        details +=
          '\n🔧 Note: Responses API endpoint may not be available for this model or provider.'
      } else if (response.status === 401) {
        details += '\n🔧 Note: API key authentication failed.'
      }

      return {
        success: false,
        message: `❌ ${endpointName} failed (${response.status})`,
        endpoint: endpointPath,
        details: details,
      }
    }
  } catch (error) {
    return {
      success: false,
      message: `❌ ${endpointName} connection failed`,
      endpoint: endpointPath,
      details: error instanceof Error ? error.message : String(error),
    }
  }
}

async function testProviderSpecificEndpoint(
  ctx: ConnectionTestContext,
  baseURL: string,
): Promise<ConnectionTestResult> {
  if (
    ctx.selectedProvider === 'anthropic' ||
    ctx.selectedProvider === 'bigdream'
  ) {
    try {
      debugLogger.api('PROVIDER_CONNECTION_TEST_NATIVE_SDK', {
        provider: ctx.selectedProvider,
      })

      let testBaseURL: string | undefined = undefined
      if (ctx.selectedProvider === 'bigdream') {
        testBaseURL = baseURL || 'https://api-key.info'
      } else if (ctx.selectedProvider === 'anthropic') {
        testBaseURL =
          baseURL && baseURL !== 'https://api.anthropic.com'
            ? baseURL
            : undefined
      }

      const isValid = await verifyApiKey(
        ctx.apiKey,
        testBaseURL,
        ctx.selectedProvider,
      )

      if (isValid) {
        return {
          success: true,
          message: `✅ ${ctx.selectedProvider} connection test passed`,
          endpoint: '/messages',
          details: 'API key verified using native SDK',
        }
      } else {
        return {
          success: false,
          message: `❌ ${ctx.selectedProvider} API key verification failed`,
          endpoint: '/messages',
          details: 'Invalid API key. Please check your API key and try again.',
        }
      }
    } catch (error) {
      debugLogger.warn('PROVIDER_CONNECTION_TEST_NATIVE_SDK_ERROR', {
        provider: ctx.selectedProvider,
        error: error instanceof Error ? error.message : String(error),
      })
      return {
        success: false,
        message: `❌ ${ctx.selectedProvider} connection failed`,
        endpoint: '/messages',
        details: error instanceof Error ? error.message : String(error),
      }
    }
  }

  return {
    success: true,
    message: `✅ Configuration saved for ${ctx.selectedProvider}`,
    details: 'Provider-specific testing not implemented yet',
  }
}
