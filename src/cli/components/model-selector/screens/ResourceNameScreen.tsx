import React from 'react'
import { Box, Newline, Text } from 'ink'

import { getTheme } from '@utils/theme'

import TextInput from '../../TextInput'

type ExitState = {
  pending: boolean
  keyName: string
}

type ResourceNameScreenProps = {
  exitState: ExitState
  onSubmit: (value: string) => void
  resourceName: string
  resourceNameCursorOffset: number
  setResourceName: (value: string) => void
  setResourceNameCursorOffset: (value: number) => void
  theme: ReturnType<typeof getTheme>
}

export function ResourceNameScreen({
  exitState,
  onSubmit,
  resourceName,
  resourceNameCursorOffset,
  setResourceName,
  setResourceNameCursorOffset,
  theme,
}: ResourceNameScreenProps): React.ReactNode {
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
          Azure Resource Setup{' '}
          {exitState.pending
            ? `(press ${exitState.keyName} again to exit)`
            : ''}
        </Text>
        <Box flexDirection="column" gap={1}>
          <Text bold>Enter your Azure OpenAI resource name:</Text>
          <Box flexDirection="column" width={70}>
            <Text color={theme.secondaryText}>
              This is the name of your Azure OpenAI resource (without the full
              domain).
              <Newline />
              For example, if your endpoint is
              "https://myresource.openai.azure.com", enter "myresource".
            </Text>
          </Box>

          <Box>
            <TextInput
              placeholder="myazureresource"
              value={resourceName}
              onChange={setResourceName}
              onSubmit={onSubmit}
              columns={100}
              cursorOffset={resourceNameCursorOffset}
              onChangeCursorOffset={setResourceNameCursorOffset}
              showCursor={true}
            />
          </Box>

          <Box marginTop={1}>
            <Text>
              <Text color={theme.suggestion} dimColor={!resourceName}>
                [Submit Resource Name]
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
