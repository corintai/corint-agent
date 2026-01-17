import React from 'react'
import { Box, Newline, Text } from 'ink'

import { getTheme } from '@utils/theme'
import type { ProviderType } from '@utils/config'

import type { ConnectionTestResult } from '../types'

type ExitState = {
  pending: boolean
  keyName: string
}

type ConnectionTestScreenProps = {
  connectionTestResult: ConnectionTestResult | null
  exitState: ExitState
  isTestingConnection: boolean
  providerDisplayName: string
  selectedProvider: ProviderType
  theme: ReturnType<typeof getTheme>
}

export function ConnectionTestScreen({
  connectionTestResult,
  exitState,
  isTestingConnection,
  providerDisplayName,
  selectedProvider,
  theme,
}: ConnectionTestScreenProps): React.ReactNode {
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
          Connection Test{' '}
          {exitState.pending ? `(press ${exitState.keyName} again to exit)` : ''}
        </Text>
        <Box flexDirection="column" gap={1}>
          <Text bold>Testing connection to {providerDisplayName}...</Text>
          <Box flexDirection="column" width={70}>
            <Text color={theme.secondaryText}>
              This will verify your configuration by sending a test request to
              the API.
              {selectedProvider === 'minimax' && (
                <>
                  <Newline />
                  For MiniMax, we'll test both v2 and v1 endpoints to find the
                  best one.
                </>
              )}
            </Text>
          </Box>

          {!connectionTestResult && !isTestingConnection && (
            <Box marginY={1}>
              <Text>
                <Text color={theme.suggestion}>Press Enter</Text> to start the
                connection test
              </Text>
            </Box>
          )}

          {isTestingConnection && (
            <Box marginY={1}>
              <Text color={theme.suggestion}>🔄 Testing connection...</Text>
            </Box>
          )}

          {connectionTestResult && (
            <Box flexDirection="column" marginY={1} paddingX={1}>
              <Text
                color={connectionTestResult.success ? theme.success : 'red'}
              >
                {connectionTestResult.message}
              </Text>

              {connectionTestResult.endpoint && (
                <Text color={theme.secondaryText}>
                  Endpoint: {connectionTestResult.endpoint}
                </Text>
              )}

              {connectionTestResult.details && (
                <Text color={theme.secondaryText}>
                  Details: {connectionTestResult.details}
                </Text>
              )}

              {connectionTestResult.success ? (
                <Box marginTop={1}>
                  <Text color={theme.success}>
                    ✅ Automatically proceeding to confirmation...
                  </Text>
                </Box>
              ) : (
                <Box marginTop={1}>
                  <Text>
                    <Text color={theme.suggestion}>Press Enter</Text> to retry
                    test, or <Text color={theme.suggestion}>Esc</Text> to go back
                  </Text>
                </Box>
              )}
            </Box>
          )}

          <Box marginTop={1}>
            <Text dimColor>
              Press <Text color={theme.suggestion}>Esc</Text> to go back to
              context length
            </Text>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
