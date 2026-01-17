import React from 'react'
import { Box, Text } from 'ink'

import { getTheme } from '@utils/theme'

export function Panel(props: {
  title: string
  subtitle?: string
  borderColor?: string
  titleColor?: string
  children?: React.ReactNode
}) {
  const theme = getTheme()
  return (
    <Box
      borderStyle="round"
      borderColor={props.borderColor ?? theme.suggestion}
      flexDirection="column"
    >
      <Box flexDirection="column" paddingX={1}>
        <Text bold color={props.titleColor ?? theme.text}>
          {props.title}
        </Text>
        {props.subtitle ? <Text dimColor>{props.subtitle}</Text> : null}
      </Box>
      <Box paddingX={1} flexDirection="column">
        {props.children}
      </Box>
    </Box>
  )
}

export function Instructions({
  instructions = 'Press ↑↓ to navigate · Enter to select · Esc to go back',
}: {
  instructions?: string
}) {
  return (
    <Box marginLeft={3}>
      <Text dimColor>{instructions}</Text>
    </Box>
  )
}
