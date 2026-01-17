import React from 'react'
import { Box, Text } from 'ink'

import { getTheme } from '@utils/theme'

import { WindowedOptions } from '../WindowedOptions'

type ExitState = {
  pending: boolean
  keyName: string
}

type PartnerProvidersScreenProps = {
  containerGap: number
  containerPaddingY: number
  exitState: ExitState
  focusedIndex: number
  maxVisible: number
  options: Array<{ value: string; label: string }>
  theme: ReturnType<typeof getTheme>
  tightLayout: boolean
}

export function PartnerProvidersScreen({
  containerGap,
  containerPaddingY,
  exitState,
  focusedIndex,
  maxVisible,
  options,
  theme,
  tightLayout,
}: PartnerProvidersScreenProps): React.ReactNode {
  const footerMarginTop = tightLayout ? 0 : 1
  return (
    <Box flexDirection="column" gap={containerGap}>
      <Box
        flexDirection="column"
        gap={containerGap}
        borderStyle="round"
        borderColor={theme.secondaryBorder}
        paddingX={2}
        paddingY={containerPaddingY}
      >
        <Text bold>
          Partner Providers{' '}
          {exitState.pending ? `(press ${exitState.keyName} again to exit)` : ''}
        </Text>
        <Box flexDirection="column" gap={containerGap}>
          <Text bold>Select a partner AI provider for this model profile:</Text>
          <Box flexDirection="column" width={70}>
            <Text color={theme.secondaryText}>
              {tightLayout
                ? 'Choose an official partner provider.'
                : 'Choose from official partner providers to access their models and services.'}
            </Text>
          </Box>

          <WindowedOptions
            options={options}
            focusedIndex={focusedIndex}
            maxVisible={maxVisible}
            theme={theme}
          />

          <Box marginTop={footerMarginTop}>
            <Text dimColor>
              Press <Text color={theme.suggestion}>Esc</Text> to go back to main
              menu
            </Text>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
