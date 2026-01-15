import React from 'react'
import { Box, Text } from 'ink'

type Props = {
  toolName: string
  toolMessage: string | React.ReactElement | null
  suffix?: React.ReactNode
}

export function ToolUseSummary({
  toolName,
  toolMessage,
  suffix,
}: Props): React.ReactNode {
  const messageNode =
    toolMessage === null ||
    toolMessage === undefined ? null : typeof toolMessage === 'string' ? (
      <Text>{toolMessage}</Text>
    ) : (
      toolMessage
    )

  return (
    <Box flexDirection="row" flexWrap="wrap">
      <Text>{toolName}</Text>
      <Text>(</Text>
      {messageNode}
      <Text>)</Text>
      {suffix ?? null}
    </Box>
  )
}
