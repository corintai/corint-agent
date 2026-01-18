import React from 'react'
import { Box, Newline, Text } from 'ink'

import { getTheme } from '@utils/theme'

import { ScreenContainer } from '../ScreenContainer'
import { WindowedOptions } from '../WindowedOptions'

type ExitState = {
  pending: boolean
  keyName: string
}

type ProviderSelectionScreenProps = {
  compactLayout: boolean
  containerGap: number
  containerPaddingY: number
  exitState: ExitState
  focusedIndex: number
  maxVisible: number
  options: Array<{ value: string; label: string }>
  theme: ReturnType<typeof getTheme>
  tightLayout: boolean
}

export function ProviderSelectionScreen({
  compactLayout,
  containerGap,
  containerPaddingY,
  exitState,
  focusedIndex,
  maxVisible,
  options,
  theme,
  tightLayout,
}: ProviderSelectionScreenProps): React.ReactNode {
  return (
    <ScreenContainer
      title="Provider Selection"
      exitState={exitState}
      paddingY={containerPaddingY}
      gap={containerGap}
      children={
        <Box flexDirection="column" gap={containerGap}>
          <Text bold>
            Select your preferred AI provider for this model profile:
          </Text>
          <Box flexDirection="column" width={70}>
            <Text color={theme.secondaryText}>
              {compactLayout ? (
                'Choose the provider to use for this profile.'
              ) : (
                <>
                  Choose the provider you want to use for this model profile.
                  <Newline />
                  This will determine which models are available to you.
                </>
              )}
            </Text>
          </Box>

          <WindowedOptions
            options={options}
            focusedIndex={focusedIndex}
            maxVisible={maxVisible}
            theme={theme}
          />

          <Box marginTop={tightLayout ? 0 : 1}>
            <Text dimColor>
              You can change this later by running{' '}
              <Text color={theme.suggestion}>/model</Text> again
            </Text>
          </Box>
        </Box>
      }
    />
  )
}
