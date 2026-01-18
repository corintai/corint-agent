import React from 'react'
import { Command } from '@commander-js/extra-typings'
import type { RenderOptions } from 'ink'
import { cwd } from 'process'
import { existsSync } from 'node:fs'

import { ResumeConversation } from '@screens/ResumeConversation'
import { setup } from '../../setup'
import { assertMinVersion } from '@utils/session/autoUpdater'
import { decorateToolsForCli } from '@cli/tools/decorateTools'
import { getCurrentProjectConfig } from '@utils/config'
import { isDefaultSlowAndCapableModel } from '@utils/model'
import { dateToFilename, logError, parseLogFilename } from '@utils/log'
import {
  CACHE_PATHS,
  getNextAvailableLogForkNumber,
  loadLogList,
} from '@utils/log'
import { loadMessagesFromLog } from '@utils/session/conversationRecovery'
import { getClients } from '@services/mcpClient'

export function registerResumeCommand(
  program: Command,
  renderContextWithExitOnCtrlC: RenderOptions | undefined,
): void {
  program
    .command('resume')
    .description(
      'Resume a previous conversation. Optionally provide a session ID or session name (legacy: log index or file path).',
    )
    .argument(
      '[identifier]',
      'A session ID or session name (legacy: log index or file path)',
    )
    .option('--cwd <cwd>', 'The current working directory', String, cwd())
    .option('-e, --enable-architect', 'Enable the Architect tool', () => true)
    .option('-v, --verbose', 'Do not truncate message output', () => true)
    .option(
      '--safe',
      'Enable strict permission checking mode (default is permissive)',
      () => true,
    )
    .option(
      '--disable-slash-commands',
      'Disable slash commands (treat /... as plain text)',
      () => true,
    )
    .action(
      async (
        identifier,
        { cwd, enableArchitect, safe, verbose, disableSlashCommands },
      ) => {
        await setup(cwd, safe)
        assertMinVersion()

        const [{ getTools }, { getCommands }] = await Promise.all([
          import('@tools'),
          import('@commands'),
        ])
        const [allTools, commands, mcpClients] = await Promise.all([
          getTools(
            enableArchitect ?? getCurrentProjectConfig().enableArchitectTool,
          ),
          getCommands(),
          getClients(),
        ])
        decorateToolsForCli()
        const tools =
          disableSlashCommands === true
            ? allTools.filter(t => t.name !== 'SlashCommand')
            : allTools

        if (identifier !== undefined) {
          const { loadKodeAgentSessionMessages } =
            await import('@utils/protocol/kodeAgentSessionLoad')
          const { resolveResumeSessionIdentifier } =
            await import('@utils/protocol/kodeAgentSessionResume')
          const { setKodeAgentSessionId } =
            await import('@utils/protocol/kodeAgentSessionId')

          const rawIdentifier = String(identifier).trim()
          const isLegacyNumber = /^-?\d+$/.test(rawIdentifier)
          const isLegacyPath = !isLegacyNumber && existsSync(rawIdentifier)

          let messages: any[] | undefined
          let messageLogName: string = dateToFilename(new Date())
          let initialForkNumber: number | undefined = undefined

          try {
            if (isLegacyNumber || isLegacyPath) {
              const logs = await loadLogList(CACHE_PATHS.messages())
              if (isLegacyNumber) {
                const number = Math.abs(parseInt(rawIdentifier, 10))
                const log = logs[number]
                if (!log) {
                  console.error('No conversation found at index', number)
                  process.exit(1)
                }
                messages = await loadMessagesFromLog(log.fullPath, tools)
                messageLogName = log.date
                initialForkNumber = getNextAvailableLogForkNumber(
                  log.date,
                  log.forkNumber ?? 1,
                  0,
                )
              } else {
                messages = await loadMessagesFromLog(rawIdentifier, tools)
                const pathSegments = rawIdentifier.split('/')
                const filename =
                  pathSegments[pathSegments.length - 1] ?? 'unknown'
                const { date, forkNumber } = parseLogFilename(filename)
                messageLogName = date
                initialForkNumber = getNextAvailableLogForkNumber(
                  date,
                  forkNumber ?? 1,
                  0,
                )
              }
            } else {
              const resolved = resolveResumeSessionIdentifier({
                cwd,
                identifier: rawIdentifier,
              })
              if (resolved.kind === 'ok') {
                setKodeAgentSessionId(resolved.sessionId)
                messages = loadKodeAgentSessionMessages({
                  cwd,
                  sessionId: resolved.sessionId,
                })
              } else if (resolved.kind === 'different_directory') {
                console.error(
                  resolved.otherCwd
                    ? `Error: That session belongs to a different directory: ${resolved.otherCwd}`
                    : `Error: That session belongs to a different directory.`,
                )
                process.exit(1)
              } else if (resolved.kind === 'ambiguous') {
                console.error(
                  `Error: Multiple sessions match "${rawIdentifier}": ${resolved.matchingSessionIds.join(
                    ', ',
                  )}`,
                )
                process.exit(1)
              } else {
                console.error(
                  `No conversation found with session ID or name: ${rawIdentifier}`,
                )
                process.exit(1)
              }
            }

            const isDefaultModel = await isDefaultSlowAndCapableModel()
            {
              const { render } = await import('ink')
              const { REPL } = await import('@screens/REPL')
              render(
                <REPL
                  initialPrompt=""
                  messageLogName={messageLogName}
                  initialForkNumber={initialForkNumber}
                  shouldShowPromptInput={true}
                  verbose={verbose}
                  commands={commands}
                  disableSlashCommands={disableSlashCommands === true}
                  tools={tools}
                  safeMode={safe}
                  initialMessages={messages}
                  mcpClients={mcpClients}
                  isDefaultModel={isDefaultModel}
                />,
                { exitOnCtrlC: false },
              )
            }
          } catch (error) {
            logError(`Failed to load conversation: ${error}`)
            process.exit(1)
          }
        } else {
          const { listKodeAgentSessions } =
            await import('@utils/protocol/kodeAgentSessionResume')
          const sessions = listKodeAgentSessions({ cwd })
          if (sessions.length === 0) {
            console.error('No conversation found to resume')
            process.exit(1)
          }

          const context: { unmount?: () => void } = {}
          ;(async () => {
            const { render } = await import('ink')
            const { unmount } = render(
              <ResumeConversation
                cwd={cwd}
                context={context}
                commands={commands}
                sessions={sessions}
                tools={tools}
                verbose={verbose}
                safeMode={safe}
                disableSlashCommands={disableSlashCommands === true}
                mcpClients={mcpClients}
                initialPrompt=""
              />,
              renderContextWithExitOnCtrlC,
            )
            context.unmount = unmount
          })()
        }
      },
    )
}
