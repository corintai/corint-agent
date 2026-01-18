import React from 'react'
import { Box, Text } from 'ink'

import { getTheme } from '@utils/theme'
import type { ProviderType } from '@utils/config'

import { CONTEXT_LENGTH_OPTIONS } from '../options'
import type { ReasoningEffortOption } from '../options'

type ExitState = {
  pending: boolean
  keyName: string
}

type ConfirmationScreenProps = {
  apiKey: string
  contextLength: number
  customBaseUrl: string
  exitState: ExitState
  formatApiKeyDisplay: (value: string) => string
  maxTokens: string
  ollamaBaseUrl: string
  providerDisplayName: string
  reasoningEffort: ReasoningEffortOption | null
  resourceName: string
  selectedModel: string
  selectedProvider: ProviderType
  supportsReasoningEffort: boolean
  theme: ReturnType<typeof getTheme>
  validationError: string | null
}

export function ConfirmationScreen({
  apiKey,
  contextLength,
  customBaseUrl,
  exitState,
  formatApiKeyDisplay,
  maxTokens,
  ollamaBaseUrl,
  providerDisplayName,
  reasoningEffort,
  resourceName,
  selectedModel,
  selectedProvider,
  supportsReasoningEffort,
  theme,
  validationError,
}: ConfirmationScreenProps): React.ReactNode {
  const showsApiKey = selectedProvider !== 'ollama'

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
          Configuration Confirmation{' '}
          {exitState.pending
            ? `(press ${exitState.keyName} again to exit)`
            : ''}
        </Text>
        <Box flexDirection="column" gap={1}>
          <Text bold>Confirm your model configuration:</Text>
          <Box flexDirection="column" width={70}>
            <Text color={theme.secondaryText}>
              Please review your selections before saving.
            </Text>
          </Box>

          {validationError && (
            <Box flexDirection="column" marginY={1} paddingX={1}>
              <Text color={theme.error} bold>
                ⚠ Configuration Error:
              </Text>
              <Text color={theme.error}>{validationError}</Text>
            </Box>
          )}

          <Box flexDirection="column" marginY={1} paddingX={1}>
            <Text>
              <Text bold>Provider: </Text>
              <Text color={theme.suggestion}>{providerDisplayName}</Text>
            </Text>

            {selectedProvider === 'azure' && (
              <Text>
                <Text bold>Resource Name: </Text>
                <Text color={theme.suggestion}>{resourceName}</Text>
              </Text>
            )}

            {selectedProvider === 'ollama' && (
              <Text>
                <Text bold>Server URL: </Text>
                <Text color={theme.suggestion}>{ollamaBaseUrl}</Text>
              </Text>
            )}

            {selectedProvider === 'custom-openai' && (
              <Text>
                <Text bold>API Base URL: </Text>
                <Text color={theme.suggestion}>{customBaseUrl}</Text>
              </Text>
            )}

            <Text>
              <Text bold>Model: </Text>
              <Text color={theme.suggestion}>{selectedModel}</Text>
            </Text>

            {apiKey && showsApiKey && (
              <Text>
                <Text bold>API Key: </Text>
                <Text color={theme.suggestion}>
                  {formatApiKeyDisplay(apiKey)}
                </Text>
              </Text>
            )}

            {maxTokens && (
              <Text>
                <Text bold>Max Tokens: </Text>
                <Text color={theme.suggestion}>{maxTokens}</Text>
              </Text>
            )}

            <Text>
              <Text bold>Context Length: </Text>
              <Text color={theme.suggestion}>
                {CONTEXT_LENGTH_OPTIONS.find(opt => opt.value === contextLength)
                  ?.label || `${contextLength.toLocaleString()} tokens`}
              </Text>
            </Text>

            {supportsReasoningEffort && (
              <Text>
                <Text bold>Reasoning Effort: </Text>
                <Text color={theme.suggestion}>{reasoningEffort}</Text>
              </Text>
            )}
          </Box>

          <Box marginTop={1}>
            <Text dimColor>
              Press <Text color={theme.suggestion}>Esc</Text> to go back to
              model parameters or <Text color={theme.suggestion}>Enter</Text> to
              save configuration
            </Text>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
