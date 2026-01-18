import React from 'react'
import { Box, Text } from 'ink'
import { extname, isAbsolute, relative, resolve } from 'path'
import { readFileSync } from 'fs'
import { EOL } from 'os'
import { FallbackToolUseRejectedMessage } from '@components/FallbackToolUseRejectedMessage'
import { HighlightedCode } from '@components/HighlightedCode'
import { StructuredDiff } from '@components/StructuredDiff'
import { FileEditToolUpdatedMessage } from '@components/FileEditToolUpdatedMessage'
import { getTheme } from '@utils/theme'
import { intersperse } from '@utils/text/array'
import { getCwd } from '@utils/state'
import { detectFileEncoding } from '@utils/fs/file'
import { fileExistsBun } from '@utils/bun/file'
import { getPatch } from '@utils/text/diff'
import { normalizeLineEndings } from '@utils/text/normalizeLineEndings'
import { BLACK_CIRCLE } from '@constants/figures'
import { formatDuration } from '@utils/format'
import type { Tool } from '@tool'
import { BashTool } from '@tools/BashTool/BashTool'
import { KillShellTool } from '@tools/KillShellTool/KillShellTool'
import { AskUserQuestionTool } from '@tools/interaction/AskUserQuestionTool/AskUserQuestionTool'
import { TodoWriteTool } from '@tools/interaction/TodoWriteTool/TodoWriteTool'
import { TaskTool } from '@tools/agent/TaskTool/TaskTool'
import { FileWriteTool } from '@tools/FileWriteTool/FileWriteTool'
import { FileEditTool } from '@tools/FileEditTool/FileEditTool'
import BashToolResultMessage from '@cli/tools/system/BashTool/BashToolResultMessage'

let decorated = false

export function decorateToolsForCli(): void {
  if (decorated) return
  decorated = true

  const bashTool = BashTool as Tool
  bashTool.renderToolUseRejectedMessage = () => (
    <FallbackToolUseRejectedMessage />
  )
  bashTool.renderToolResultMessage = content => (
    <BashToolResultMessage content={content} verbose={false} />
  )

  const killShellTool = KillShellTool as Tool
  killShellTool.renderToolUseRejectedMessage = () => (
    <FallbackToolUseRejectedMessage />
  )
  killShellTool.renderToolResultMessage = output => (
    <Box flexDirection="row">
      <Text>&nbsp;&nbsp;⎿ &nbsp;</Text>
      <Text>Shell {output.shell_id} killed</Text>
    </Box>
  )

  const todoWriteTool = TodoWriteTool as Tool
  todoWriteTool.renderToolUseRejectedMessage = () => (
    <FallbackToolUseRejectedMessage />
  )
  todoWriteTool.renderToolResultMessage = () => null

  const taskTool = TaskTool as Tool
  taskTool.renderToolResultMessage = (output: any) => {
    if (!output || output.status !== 'completed') {
      return null
    }
    const durationMs =
      typeof output.totalDurationMs === 'number' ? output.totalDurationMs : null
    if (durationMs === null) return null
    return (
      <Box flexDirection="row">
        <Text>&nbsp;&nbsp;⎿ &nbsp;</Text>
        <Text>Task completed in {formatDuration(durationMs)}</Text>
      </Box>
    )
  }

  const askUserQuestionTool = AskUserQuestionTool as Tool
  askUserQuestionTool.renderToolUseRejectedMessage = () => {
    const theme = getTheme()
    return (
      <Box flexDirection="row" marginTop={1}>
        <Text color={theme.text}>{BLACK_CIRCLE}&nbsp;</Text>
        <Text>User declined to answer questions</Text>
      </Box>
    )
  }
  askUserQuestionTool.renderToolResultMessage = (output: any) => {
    const theme = getTheme()
    return (
      <Box flexDirection="column" marginTop={1}>
        <Box flexDirection="row">
          <Text color={theme.text}>{BLACK_CIRCLE}&nbsp;</Text>
          <Text>User answered Kode Agent&apos;s questions:</Text>
        </Box>
        <Box flexDirection="column" paddingLeft={2}>
          {Object.entries(output.answers).map(([question, answer]) => (
            <Box key={question}>
              <Text dimColor>
                · {question} → {answer}
              </Text>
            </Box>
          ))}
        </Box>
      </Box>
    )
  }

  const fileWriteTool = FileWriteTool as Tool
  fileWriteTool.renderToolUseRejectedMessage = (
    { file_path, content }: any = {},
    { columns, verbose }: any = {},
  ) => {
    try {
      if (!file_path) {
        return <FallbackToolUseRejectedMessage />
      }
      const fullFilePath = isAbsolute(file_path)
        ? file_path
        : resolve(getCwd(), file_path)
      const oldFileExists = fileExistsBun(fullFilePath)
      const enc = oldFileExists ? detectFileEncoding(fullFilePath) : 'utf-8'
      const oldContent = oldFileExists ? readFileSync(fullFilePath, enc) : null
      const type = oldContent ? 'update' : 'create'
      const patch = getPatch({
        filePath: file_path,
        fileContents: oldContent ?? '',
        oldStr: oldContent ?? '',
        newStr: content,
      })

      return (
        <Box flexDirection="column">
          <Text>
            {'  '}⎿{' '}
            <Text color={getTheme().error}>
              User rejected {type === 'update' ? 'update' : 'write'} to{' '}
            </Text>
            <Text bold>
              {verbose ? file_path : relative(getCwd(), file_path)}
            </Text>
          </Text>
          {intersperse(
            patch.map(_ => (
              <Box flexDirection="column" paddingLeft={5} key={_.newStart}>
                <StructuredDiff patch={_} dim={true} width={columns - 12} />
              </Box>
            )),
            i => (
              <Box paddingLeft={5} key={`ellipsis-${i}`}>
                <Text color={getTheme().secondaryText}>...</Text>
              </Box>
            ),
          )}
        </Box>
      )
    } catch {
      return (
        <Box flexDirection="column">
          <Text>{'  '}⎿ (No changes)</Text>
        </Box>
      )
    }
  }

  fileWriteTool.renderToolResultMessage = ({
    filePath,
    content,
    structuredPatch,
    type,
  }: any) => {
    const verbose = false
    switch (type) {
      case 'create': {
        const contentWithFallback = content || '(No content)'
        const numLines = content.split(EOL).length

        return (
          <Box flexDirection="column">
            <Text>
              {'  '}⎿ Wrote {numLines} lines to{' '}
              <Text bold>
                {verbose ? filePath : relative(getCwd(), filePath)}
              </Text>
            </Text>
            <Box flexDirection="column" paddingLeft={5}>
              <HighlightedCode
                code={
                  verbose
                    ? contentWithFallback
                    : contentWithFallback
                        .split('\n')
                        .slice(0, 5)
                        .filter(_ => _.trim() !== '')
                        .join('\n')
                }
                language={extname(filePath).slice(1)}
              />
              {!verbose && numLines > 5 && (
                <Text color={getTheme().secondaryText}>
                  ... (+{numLines - 5} lines)
                </Text>
              )}
            </Box>
          </Box>
        )
      }
      case 'update':
        return (
          <FileEditToolUpdatedMessage
            filePath={filePath}
            structuredPatch={structuredPatch}
            verbose={verbose}
          />
        )
    }
    return null
  }

  const fileEditTool = FileEditTool as Tool
  fileEditTool.renderToolUseRejectedMessage = (
    { file_path, old_string, new_string, replace_all }: any = {},
    { columns, verbose }: any = {},
  ) => {
    try {
      if (!file_path) {
        return <FallbackToolUseRejectedMessage />
      }
      const fullFilePath = isAbsolute(file_path)
        ? file_path
        : resolve(getCwd(), file_path)

      let originalFile = ''
      let updatedFile = ''
      if (old_string === '') {
        originalFile = ''
        updatedFile = normalizeLineEndings(new_string)
      } else {
        const enc = detectFileEncoding(fullFilePath)
        const fileContent = readFileSync(fullFilePath, enc)
        originalFile = normalizeLineEndings(fileContent ?? '')

        const normalizedOldString = normalizeLineEndings(old_string)
        const normalizedNewString = normalizeLineEndings(new_string)
        const oldStringForReplace =
          normalizedNewString === '' &&
          !normalizedOldString.endsWith('\n') &&
          originalFile.includes(normalizedOldString + '\n')
            ? normalizedOldString + '\n'
            : normalizedOldString

        updatedFile = Boolean(replace_all)
          ? originalFile.split(oldStringForReplace).join(normalizedNewString)
          : originalFile.replace(oldStringForReplace, () => normalizedNewString)

        if (updatedFile === originalFile) {
          throw new Error(
            'Original and edited file match exactly. Failed to apply edit.',
          )
        }
      }

      const patch = getPatch({
        filePath: file_path,
        fileContents: originalFile,
        oldStr: originalFile,
        newStr: updatedFile,
      })
      return (
        <Box flexDirection="column">
          <Text>
            {'  '}⎿{' '}
            <Text color={getTheme().error}>
              User rejected {old_string === '' ? 'write' : 'update'} to{' '}
            </Text>
            <Text bold>
              {verbose ? file_path : relative(getCwd(), file_path)}
            </Text>
          </Text>
          {intersperse(
            patch.map(patch => (
              <Box flexDirection="column" paddingLeft={5} key={patch.newStart}>
                <StructuredDiff patch={patch} dim={true} width={columns - 12} />
              </Box>
            )),
            i => (
              <Box paddingLeft={5} key={`ellipsis-${i}`}>
                <Text color={getTheme().secondaryText}>...</Text>
              </Box>
            ),
          )}
        </Box>
      )
    } catch {
      return (
        <Box flexDirection="column">
          <Text>{'  '}⎿ (No changes)</Text>
        </Box>
      )
    }
  }

  fileEditTool.renderToolResultMessage = ({
    filePath,
    structuredPatch,
  }: any) => {
    const verbose = false
    return (
      <FileEditToolUpdatedMessage
        filePath={filePath}
        structuredPatch={structuredPatch}
        verbose={verbose}
      />
    )
  }
}
