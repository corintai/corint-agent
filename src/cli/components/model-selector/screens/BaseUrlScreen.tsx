import React from 'react'
import { Box, Newline, Text } from 'ink'

import { getTheme } from '@utils/theme'
import type { ProviderType } from '@utils/config'
import { providers } from '@constants/models'

import TextInput from '../../TextInput'

type ExitState = {
  pending: boolean
  keyName: string
}

type BaseUrlScreenProps = {
  customBaseUrl: string
  customBaseUrlCursorOffset: number
  exitState: ExitState
  isLoadingModels: boolean
  modelLoadError: string | null
  onCustomBaseUrlSubmit: (value: string) => void
  onProviderBaseUrlSubmit: (value: string) => void
  providerBaseUrl: string
  providerBaseUrlCursorOffset: number
  selectedProvider: ProviderType
  setCustomBaseUrl: (value: string) => void
  setCustomBaseUrlCursorOffset: (value: number) => void
  setProviderBaseUrl: (value: string) => void
  setProviderBaseUrlCursorOffset: (value: number) => void
  theme: ReturnType<typeof getTheme>
}

export function BaseUrlScreen({
  customBaseUrl,
  customBaseUrlCursorOffset,
  exitState,
  isLoadingModels,
  modelLoadError,
  onCustomBaseUrlSubmit,
  onProviderBaseUrlSubmit,
  providerBaseUrl,
  providerBaseUrlCursorOffset,
  selectedProvider,
  setCustomBaseUrl,
  setCustomBaseUrlCursorOffset,
  setProviderBaseUrl,
  setProviderBaseUrlCursorOffset,
  theme,
}: BaseUrlScreenProps): React.ReactNode {
  const isCustomOpenAI = selectedProvider === 'custom-openai'

  if (isCustomOpenAI) {
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
            Custom API Server Setup{' '}
            {exitState.pending
              ? `(press ${exitState.keyName} again to exit)`
              : ''}
          </Text>
          <Box flexDirection="column" gap={1}>
            <Text bold>Enter your custom API URL:</Text>
            <Box flexDirection="column" width={70}>
              <Text color={theme.secondaryText}>
                This is the base URL for your OpenAI-compatible API.
                <Newline />
                For example: https://api.example.com/v1
              </Text>
            </Box>

            <Box>
              <TextInput
                placeholder="https://api.example.com/v1"
                value={customBaseUrl}
                onChange={setCustomBaseUrl}
                onSubmit={onCustomBaseUrlSubmit}
                columns={100}
                cursorOffset={customBaseUrlCursorOffset}
                onChangeCursorOffset={setCustomBaseUrlCursorOffset}
                showCursor={!isLoadingModels}
                focus={!isLoadingModels}
              />
            </Box>

            <Box marginTop={1}>
              <Text>
                <Text
                  color={
                    isLoadingModels ? theme.secondaryText : theme.suggestion
                  }
                >
                  [Submit Base URL]
                </Text>
                <Text> - Press Enter or click to continue</Text>
              </Text>
            </Box>

            <Box marginTop={1}>
              <Text dimColor>
                Press <Text color={theme.suggestion}>Enter</Text> to continue or{' '}
                <Text color={theme.suggestion}>Esc</Text> to go back
              </Text>
            </Box>
          </Box>
        </Box>
      </Box>
    )
  }

  const providerName = providers[selectedProvider]?.name || selectedProvider
  const defaultUrl = providers[selectedProvider]?.baseURL || ''

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
          {providerName} API Configuration{' '}
          {exitState.pending
            ? `(press ${exitState.keyName} again to exit)`
            : ''}
        </Text>
        <Box flexDirection="column" gap={1}>
          <Text bold>Configure the API endpoint for {providerName}:</Text>
          <Box flexDirection="column" width={70}>
            <Text color={theme.secondaryText}>
              {selectedProvider === 'ollama' ? (
                <>
                  This is the URL of your Ollama server.
                  <Newline />
                  Default is http://localhost:11434/v1 for local Ollama
                  installations.
                </>
              ) : (
                <>
                  This is the base URL for the {providerName} API.
                  <Newline />
                  You can modify this URL or press Enter to use the default.
                </>
              )}
            </Text>
          </Box>

          <Box>
            <TextInput
              placeholder={defaultUrl}
              value={providerBaseUrl}
              onChange={setProviderBaseUrl}
              onSubmit={onProviderBaseUrlSubmit}
              columns={100}
              cursorOffset={providerBaseUrlCursorOffset}
              onChangeCursorOffset={setProviderBaseUrlCursorOffset}
              showCursor={!isLoadingModels}
              focus={!isLoadingModels}
            />
          </Box>

          <Box marginTop={1}>
            <Text>
              <Text
                color={isLoadingModels ? theme.secondaryText : theme.suggestion}
              >
                [Submit Base URL]
              </Text>
              <Text> - Press Enter or click to continue</Text>
            </Text>
          </Box>

          {isLoadingModels && (
            <Box marginTop={1}>
              <Text color={theme.success}>
                {selectedProvider === 'ollama'
                  ? 'Connecting to Ollama server...'
                  : `Connecting to ${providerName}...`}
              </Text>
            </Box>
          )}

          {modelLoadError && (
            <Box marginTop={1}>
              <Text color="red">Error: {modelLoadError}</Text>
            </Box>
          )}

          <Box marginTop={1}>
            <Text dimColor>
              Press <Text color={theme.suggestion}>Enter</Text> to continue or{' '}
              <Text color={theme.suggestion}>Esc</Text> to go back
            </Text>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
