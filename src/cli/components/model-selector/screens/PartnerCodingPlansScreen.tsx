import React from 'react'
import { Box, Newline, Text } from 'ink'

import { getTheme } from '@utils/theme'

import { WindowedOptions } from '../WindowedOptions'

type ExitState = {
  pending: boolean
  keyName: string
}

type PartnerCodingPlansScreenProps = {
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

export function PartnerCodingPlansScreen({
  compactLayout,
  containerGap,
  containerPaddingY,
  exitState,
  focusedIndex,
  maxVisible,
  options,
  theme,
  tightLayout,
}: PartnerCodingPlansScreenProps): React.ReactNode {
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
          Partner Coding Plans{' '}
          {exitState.pending
            ? `(press ${exitState.keyName} again to exit)`
            : ''}
        </Text>
        <Box flexDirection="column" gap={containerGap}>
          <Text bold>
            Select a partner coding plan for specialized programming assistance:
          </Text>
          <Box flexDirection="column" width={70}>
            <Text color={theme.secondaryText}>
              {compactLayout ? (
                'Specialized coding models from partners.'
              ) : (
                <>
                  These are specialized models optimized for coding and
                  development tasks.
                  <Newline />
                  They require specific coding plan subscriptions from the
                  respective providers.
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
