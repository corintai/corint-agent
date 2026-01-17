import React from 'react'
import { Box, Text } from 'ink'
import figures from 'figures'

import { getTheme } from '@utils/theme'

type WindowedOptionsProps = {
  options: Array<{ value: string; label: string }>
  focusedIndex: number
  maxVisible: number
  theme: ReturnType<typeof getTheme>
}

export const WindowedOptions = React.memo(function WindowedOptions({
  options,
  focusedIndex,
  maxVisible,
  theme,
}: WindowedOptionsProps) {
  if (options.length === 0) {
    return <Text color={theme.secondaryText}>No options available.</Text>
  }

  const visibleCount = Math.max(1, Math.min(maxVisible, options.length))
  const half = Math.floor(visibleCount / 2)
  const start = Math.max(
    0,
    Math.min(focusedIndex - half, Math.max(0, options.length - visibleCount)),
  )
  const end = Math.min(options.length, start + visibleCount)
  const showUp = start > 0
  const showDown = end < options.length

  return (
    <Box flexDirection="column" gap={0}>
      {showUp && (
        <Text color={theme.secondaryText}>{figures.arrowUp} More</Text>
      )}
      {options.slice(start, end).map((opt, idx) => {
        const absoluteIndex = start + idx
        const isFocused = absoluteIndex === focusedIndex
        return (
          <Box key={opt.value} flexDirection="row">
            <Text color={isFocused ? theme.kode : theme.secondaryText}>
              {isFocused ? figures.pointer : ' '}
            </Text>
            <Text
              color={isFocused ? theme.text : theme.secondaryText}
              bold={isFocused}
            >
              {' '}
              {opt.label}
            </Text>
          </Box>
        )
      })}
      {showDown && (
        <Text color={theme.secondaryText}>{figures.arrowDown} More</Text>
      )}
    </Box>
  )
})
