import React from 'react'
import { Box, Text } from 'ink'

import { getTheme } from '@utils/theme'

import { CONTEXT_LENGTH_OPTIONS, DEFAULT_CONTEXT_LENGTH } from '../options'

type ExitState = {
  pending: boolean
  keyName: string
}

type ContextLengthScreenProps = {
  contextLength: number
  exitState: ExitState
  theme: ReturnType<typeof getTheme>
}

export function ContextLengthScreen({
  contextLength,
  exitState,
  theme,
}: ContextLengthScreenProps): React.ReactNode {
  const selectedOption =
    CONTEXT_LENGTH_OPTIONS.find(opt => opt.value === contextLength) ||
    CONTEXT_LENGTH_OPTIONS[2]

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
          Context Length Configuration{' '}
          {exitState.pending
            ? `(press ${exitState.keyName} again to exit)`
            : ''}
        </Text>
        <Box flexDirection="column" gap={1}>
          <Text bold>Choose the context window length for your model:</Text>
          <Box flexDirection="column" width={70}>
            <Text color={theme.secondaryText}>
              This determines how much conversation history and context the
              model can process at once. Higher values allow for longer
              conversations but may increase costs.
            </Text>
          </Box>

          <Box flexDirection="column" marginY={1}>
            {CONTEXT_LENGTH_OPTIONS.map(option => {
              const isSelected = option.value === contextLength
              return (
                <Box key={option.value} flexDirection="row">
                  <Text color={isSelected ? 'blue' : undefined}>
                    {isSelected ? '→ ' : '  '}
                    {option.label}
                    {option.value === DEFAULT_CONTEXT_LENGTH
                      ? ' (recommended)'
                      : ''}
                  </Text>
                </Box>
              )
            })}
          </Box>

          <Box flexDirection="column" marginY={1}>
            <Text dimColor>
              Selected:{' '}
              <Text color={theme.suggestion}>{selectedOption.label}</Text>
            </Text>
          </Box>
        </Box>
      </Box>

      <Box marginLeft={1}>
        <Text dimColor>↑/↓ to select · Enter to continue · Esc to go back</Text>
      </Box>
    </Box>
  )
}
