import React from 'react'
import { Box, Newline, Text } from 'ink'

import { getTheme } from '@utils/theme'
import type { ProviderType } from '@utils/config'

import TextInput from '../../TextInput'

type ExitState = {
  pending: boolean
  keyName: string
}

type ApiKeyScreenProps = {
  apiKey: string
  apiKeyCleanedNotification: boolean
  cursorOffset: number
  exitState: ExitState
  formatApiKeyDisplay: (key: string) => string
  isLoadingModels: boolean
  modelLoadError: string | null
  onApiKeyChange: (value: string) => void
  onApiKeySubmit: (value: string) => void
  onCursorOffsetChange: (offset: number) => void
  providerBaseUrl: string
  providerLabel: string
  selectedProvider: ProviderType
  theme: ReturnType<typeof getTheme>
}

export function ApiKeyScreen({
  apiKey,
  apiKeyCleanedNotification,
  cursorOffset,
  exitState,
  formatApiKeyDisplay,
  isLoadingModels,
  modelLoadError,
  onApiKeyChange,
  onApiKeySubmit,
  onCursorOffsetChange,
  providerBaseUrl,
  providerLabel,
  selectedProvider,
  theme,
}: ApiKeyScreenProps): React.ReactNode {
  const modelTypeText = 'this model profile'

  return (
    <Box flexDirection="column" gap={1}>
      <Box
        flexDirection="column"
        gap={1}
        borderStyle="round"
        borderColor={theme.secondaryBorder}
        paddingX={2}
        paddingY={1}
      >
        <Text bold>
          API Key Setup{' '}
          {exitState.pending
            ? `(press ${exitState.keyName} again to exit)`
            : ''}
        </Text>
        <Box flexDirection="column" gap={1}>
          <Text bold>
            Enter your {providerLabel} API key for {modelTypeText}:
          </Text>
          <Box flexDirection="column" width={70}>
            <Text color={theme.secondaryText}>
              This key will be stored locally and used to access the{' '}
              {selectedProvider} API.
              <Newline />
              Your key is never sent to our servers.
              <Newline />
              <Newline />
              {selectedProvider === 'kimi' && (
                <>
                  💡 Get your API key from:{' '}
                  <Text color={theme.suggestion}>
                    https://platform.moonshot.cn/console/api-keys
                  </Text>
                </>
              )}
              {selectedProvider === 'deepseek' && (
                <>
                  💡 Get your API key from:{' '}
                  <Text color={theme.suggestion}>
                    https://platform.deepseek.com/api_keys
                  </Text>
                </>
              )}
              {selectedProvider === 'siliconflow' && (
                <>
                  💡 Get your API key from:{' '}
                  <Text color={theme.suggestion}>
                    https://cloud.siliconflow.cn/i/oJWsm6io
                  </Text>
                </>
              )}
              {selectedProvider === 'qwen' && (
                <>
                  💡 Get your API key from:{' '}
                  <Text color={theme.suggestion}>
                    https://bailian.console.aliyun.com/?tab=model#/api-key
                  </Text>
                </>
              )}
              {selectedProvider === 'glm' && (
                <>
                  💡 Get your API key from:{' '}
                  <Text color={theme.suggestion}>
                    https://open.bigmodel.cn (API Keys section)
                  </Text>
                </>
              )}
              {selectedProvider === 'glm-coding' && (
                <>
                  💡 This is for GLM Coding Plan API.{' '}
                  <Text color={theme.suggestion}>
                    Use the same API key as regular GLM
                  </Text>
                  <Newline />
                  <Text dimColor>
                    Note: This uses a special endpoint for coding tasks.
                  </Text>
                </>
              )}
              {selectedProvider === 'minimax' && (
                <>
                  💡 Get your API key from:{' '}
                  <Text color={theme.suggestion}>
                    https://www.minimax.io/platform/user-center/basic-information
                  </Text>
                </>
              )}
              {selectedProvider === 'minimax-coding' && (
                <>
                  💡 Get your Coding Plan API key from:{' '}
                  <Text color={theme.suggestion}>
                    https://platform.minimaxi.com/user-center/payment/coding-plan
                  </Text>
                  <Newline />
                  <Text dimColor>
                    Note: This requires a MiniMax Coding Plan subscription.
                  </Text>
                </>
              )}
              {selectedProvider === 'baidu-qianfan' && (
                <>
                  💡 Get your API key from:{' '}
                  <Text color={theme.suggestion}>
                    https://console.bce.baidu.com/iam/#/iam/accesslist
                  </Text>
                </>
              )}
              {selectedProvider === 'anthropic' && (
                <>💡 Get your API key from your provider dashboard.</>
              )}
              {selectedProvider === 'openai' && (
                <>
                  💡 Get your API key from:{' '}
                  <Text color={theme.suggestion}>
                    https://platform.openai.com/api-keys
                  </Text>
                </>
              )}
            </Text>
          </Box>

          <Box flexDirection="column">
            <Box>
              <TextInput
                placeholder="Paste your API key here..."
                value={apiKey}
                onChange={onApiKeyChange}
                onSubmit={onApiKeySubmit}
                onPaste={onApiKeyChange}
                mask="*"
                columns={80}
                cursorOffset={cursorOffset}
                onChangeCursorOffset={onCursorOffsetChange}
                showCursor={true}
              />
            </Box>

            {apiKey && (
              <Box marginTop={1}>
                <Text color={theme.secondaryText}>
                  Key: {formatApiKeyDisplay(apiKey)} ({apiKey.length} chars)
                </Text>
              </Box>
            )}
          </Box>

          {apiKeyCleanedNotification && (
            <Box marginTop={1}>
              <Text color={theme.success}>
                ✓ API key cleaned: removed line breaks and trimmed whitespace
              </Text>
            </Box>
          )}

          <Box marginTop={1}>
            <Text>
              <Text color={theme.suggestion} dimColor={!apiKey}>
                [Submit API Key]
              </Text>
              <Text> - Press Enter to validate and continue</Text>
            </Text>
          </Box>

          {isLoadingModels && (
            <Box marginTop={1}>
              <Text color={theme.suggestion}>
                Validating API key and fetching models...
              </Text>
              {providerBaseUrl && (
                <Text dimColor>Endpoint: {providerBaseUrl}/v1/models</Text>
              )}
            </Box>
          )}

          {modelLoadError && (
            <Box marginTop={1} flexDirection="column">
              <Text color="red">❌ API Key Validation Failed</Text>
              <Text color="red">{modelLoadError}</Text>
              {providerBaseUrl && (
                <Box marginTop={1}>
                  <Text dimColor>
                    Attempted endpoint: {providerBaseUrl}/v1/models
                  </Text>
                </Box>
              )}
              <Box marginTop={1}>
                <Text color={theme.warning}>
                  Please check your API key and try again.
                </Text>
              </Box>
            </Box>
          )}
          <Box marginTop={1}>
            <Text dimColor>
              Press <Text color={theme.suggestion}>Enter</Text> to continue,{' '}
              <Text color={theme.suggestion}>Tab</Text> to{' '}
              {selectedProvider === 'anthropic' ||
              selectedProvider === 'kimi' ||
              selectedProvider === 'deepseek' ||
              selectedProvider === 'qwen' ||
              selectedProvider === 'glm' ||
              selectedProvider === 'glm-coding' ||
              selectedProvider === 'minimax' ||
              selectedProvider === 'minimax-coding' ||
              selectedProvider === 'baidu-qianfan' ||
              selectedProvider === 'siliconflow' ||
              selectedProvider === 'custom-openai'
                ? 'skip to manual model input'
                : 'skip using a key'}
              , or <Text color={theme.suggestion}>Esc</Text> to go back
            </Text>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
