import React from 'react'
import { Box, Text } from 'ink'
import { getTheme } from '@utils/theme'

type Props = {
  onDone(): void
}

// OAuth flow removed - this is a stub component
export function ConsoleOAuthFlow({ onDone }: Props) {
  const theme = getTheme()

  React.useEffect(() => {
    // Auto-complete since OAuth is not available
    const timer = setTimeout(() => {
      onDone()
    }, 100)
    return () => clearTimeout(timer)
  }, [onDone])

  return (
    <Box flexDirection="column" padding={1}>
      <Text color={theme.secondaryText}>
        OAuth authentication is not available in this version.
      </Text>
      <Text color={theme.secondaryText}>
        Please configure your API keys using /model command.
      </Text>
    </Box>
  )
}
