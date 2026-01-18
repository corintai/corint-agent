import React from 'react'
import { Box, Text } from 'ink'

import { getTheme } from '@utils/theme'

import { Select } from '../../custom-select/select'
import {
  MAX_TOKENS_OPTIONS,
  REASONING_EFFORT_OPTIONS,
  ReasoningEffortOption,
} from '../options'

type ExitState = {
  pending: boolean
  keyName: string
}

type ModelParamField = {
  name: string
  label: string
  description?: string
  value?: any
  component: 'select' | 'button'
  options?: Array<{ label: string; value: string }>
  defaultValue?: string
}

type ModelParamsScreenProps = {
  activeFieldIndex: number
  exitState: ExitState
  formFields: ModelParamField[]
  maxTokens: string
  reasoningEffort: ReasoningEffortOption | null
  selectedModel: string
  setActiveFieldIndex: React.Dispatch<React.SetStateAction<number>>
  setMaxTokens: (value: string) => void
  setMaxTokensCursorOffset: (value: number) => void
  setSelectedMaxTokensPreset: (value: number) => void
  setReasoningEffort: (value: ReasoningEffortOption) => void
  theme: ReturnType<typeof getTheme>
}

export function ModelParamsScreen({
  activeFieldIndex,
  exitState,
  formFields,
  maxTokens,
  reasoningEffort,
  selectedModel,
  setActiveFieldIndex,
  setMaxTokens,
  setMaxTokensCursorOffset,
  setSelectedMaxTokensPreset,
  setReasoningEffort,
  theme,
}: ModelParamsScreenProps): React.ReactNode {
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
          Model Parameters{' '}
          {exitState.pending
            ? `(press ${exitState.keyName} again to exit)`
            : ''}
        </Text>
        <Box flexDirection="column" gap={1}>
          <Text bold>Configure parameters for {selectedModel}:</Text>
          <Box flexDirection="column" width={70}>
            <Text color={theme.secondaryText}>
              Use <Text color={theme.suggestion}>Tab</Text> to navigate between
              fields. Press <Text color={theme.suggestion}>Enter</Text> to
              submit.
            </Text>
          </Box>

          <Box flexDirection="column">
            {formFields.map((field, index) => (
              <Box flexDirection="column" marginY={1} key={field.name}>
                {field.component !== 'button' ? (
                  <>
                    <Text
                      bold
                      color={
                        activeFieldIndex === index ? theme.success : undefined
                      }
                    >
                      {field.label}
                    </Text>
                    {field.description && (
                      <Text color={theme.secondaryText}>
                        {field.description}
                      </Text>
                    )}
                  </>
                ) : (
                  <Text
                    bold
                    color={
                      activeFieldIndex === index ? theme.success : undefined
                    }
                  >
                    {field.label}
                  </Text>
                )}
                <Box marginY={1}>
                  {activeFieldIndex === index ? (
                    field.component === 'select' ? (
                      field.name === 'maxTokens' ? (
                        <Select
                          options={field.options || []}
                          onChange={value => {
                            const numValue = parseInt(value)
                            setMaxTokens(numValue.toString())
                            setSelectedMaxTokensPreset(numValue)
                            setMaxTokensCursorOffset(numValue.toString().length)
                            setTimeout(() => {
                              setActiveFieldIndex(index + 1)
                            }, 100)
                          }}
                          defaultValue={field.defaultValue}
                          visibleOptionCount={10}
                        />
                      ) : (
                        <Select
                          options={REASONING_EFFORT_OPTIONS}
                          onChange={value => {
                            setReasoningEffort(value as ReasoningEffortOption)
                            setTimeout(() => {
                              setActiveFieldIndex(index + 1)
                            }, 100)
                          }}
                          defaultValue={reasoningEffort}
                          visibleOptionCount={8}
                        />
                      )
                    ) : null
                  ) : field.name === 'maxTokens' ? (
                    <Text color={theme.secondaryText}>
                      Current:{' '}
                      <Text color={theme.suggestion}>
                        {MAX_TOKENS_OPTIONS.find(
                          opt => opt.value === parseInt(maxTokens),
                        )?.label || `${maxTokens} tokens`}
                      </Text>
                    </Text>
                  ) : field.name === 'reasoningEffort' ? (
                    <Text color={theme.secondaryText}>
                      Current:{' '}
                      <Text color={theme.suggestion}>{reasoningEffort}</Text>
                    </Text>
                  ) : null}
                </Box>
              </Box>
            ))}

            <Box marginTop={1}>
              <Text dimColor>
                Press <Text color={theme.suggestion}>Tab</Text> to navigate,{' '}
                <Text color={theme.suggestion}>Enter</Text> to continue, or{' '}
                <Text color={theme.suggestion}>Esc</Text> to go back
              </Text>
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
