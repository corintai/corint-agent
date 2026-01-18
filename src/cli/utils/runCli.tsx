import { openSync } from 'fs'
import { ReadStream } from 'tty'
import React from 'react'
import { Command } from '@commander-js/extra-typings'
import type { RenderOptions } from 'ink'
import { cwd } from 'process'
import { cursorShow } from 'ansi-escapes'

import { PRODUCT_COMMAND, PRODUCT_NAME } from '@constants/product'
import { MACRO } from '@core/utils/macros'
import { runPrintMode } from './printMode'
import { setup } from './setup'
import { showSetupScreens } from './setupScreens'
import { decorateToolsForCli } from '@cli/tools/decorateTools'
import { initDebugLogger } from '@utils/log/debugLogger'
import { dateToFilename, logError } from '@utils/log'
import { isDefaultSlowAndCapableModel } from '@utils/model'
import { assertMinVersion } from '@utils/session/autoUpdater'
import { BunShell } from '@utils/bun/shell'
import { showInvalidConfigDialog } from '@components/InvalidConfigDialog'
import { ConfigParseError } from '@utils/text/errors'
import { clearOutputStyleCache } from '@services/outputStyles'
import { ResumeConversation } from '@screens/ResumeConversation'
import {
  enableConfigs,
  getCurrentProjectConfig,
  validateAndRepairAllGPT5Profiles,
} from '@utils/config'
import { clearAgentCache, setFlagAgentsFromCliJson } from '@utils/agent/loader'
import { setEnabledSettingSourcesFromCli } from '@utils/config/settingSources'
import { getClients, getClientsForCliMcpConfig } from '@services/mcpClient'

import { registerAgentCommands } from './runCli/commands/agents'
import { registerApprovedToolsCommands } from './runCli/commands/approvedTools'
import { registerConfigCommands } from './runCli/commands/config'
import { registerContextCommands } from './runCli/commands/context'
import { registerDoctorCommand } from './runCli/commands/doctor'
import { registerLogCommands } from './runCli/commands/logs'
import { registerMcpCommands } from './runCli/commands/mcp'
import { registerModelCommands } from './runCli/commands/models'
import { registerPluginCommands } from './runCli/commands/plugins'
import { registerResumeCommand } from './runCli/commands/resume'
import { registerSkillCommands } from './runCli/commands/skills'
import { registerUpdateCommand } from './runCli/commands/update'

export async function runCli() {
  initDebugLogger()

  try {
    enableConfigs()

    queueMicrotask(() => {
      try {
        validateAndRepairAllGPT5Profiles()
      } catch (repairError) {
        logError(`GPT-5 configuration validation failed: ${repairError}`)
      }
    })
  } catch (error: unknown) {
    if (error instanceof ConfigParseError) {
      await showInvalidConfigDialog({ error })
      return
    }
  }

  let inputPrompt = ''
  let renderContext: RenderOptions | undefined = {
    exitOnCtrlC: false,

    onFlicker() {},
  } as any

  const wantsStreamJsonStdin =
    process.argv.some(
      (arg, idx, all) =>
        arg === '--input-format' && all[idx + 1] === 'stream-json',
    ) || process.argv.some(arg => arg.startsWith('--input-format=stream-json'))

  if (
    !process.stdin.isTTY &&
    !process.env.CI &&
    !process.argv.includes('mcp') &&
    !wantsStreamJsonStdin
  ) {
    inputPrompt = await stdin()
    if (process.platform !== 'win32') {
      try {
        const ttyFd = openSync('/dev/tty', 'r')
        renderContext = { ...renderContext, stdin: new ReadStream(ttyFd) }
      } catch (err) {
        logError(`Could not open /dev/tty: ${err}`)
      }
    }
  }
  await parseArgs(inputPrompt, renderContext)
}

async function parseArgs(
  stdinContent: string,
  renderContext: RenderOptions | undefined,
): Promise<Command> {
  const program = new Command()

  const renderContextWithExitOnCtrlC = {
    ...renderContext,
    exitOnCtrlC: true,
  }

  program
    .name(PRODUCT_COMMAND)
    .description(
      `${PRODUCT_NAME} - starts an interactive session by default, use -p/--print for non-interactive output`,
    )
    .argument('[prompt]', 'Your prompt', String)
    .option('--cwd <cwd>', 'The current working directory', String, cwd())
    .option(
      '-d, --debug [filter]',
      'Enable debug mode with optional category filtering (e.g., "api,hooks" or "!statsig,!file")',
    )
    .option(
      '--debug-verbose',
      'Enable verbose debug terminal output',
      () => true,
    )
    .option(
      '--verbose',
      'Override verbose mode setting from config',
      () => true,
    )
    .option('-e, --enable-architect', 'Enable the Architect tool', () => true)
    .option(
      '-p, --print',
      'Print response and exit (useful for pipes)',
      () => true,
    )
    .option(
      '--output-format <format>',
      'Output format (only works with --print): "text" (default), "json", or "stream-json"',
      String,
      'text',
    )
    .option(
      '--json-schema <schema>',
      'JSON Schema for structured output validation. Example: {"type":"object","properties":{"name":{"type":"string"}},"required":["name"]}',
      String,
    )
    .option(
      '--input-format <format>',
      'Input format (only works with --print): "text" (default) or "stream-json"',
      String,
      'text',
    )
    .option(
      '--mcp-debug',
      '[DEPRECATED. Use --debug instead] Enable MCP debug mode (shows MCP server errors)',
      () => true,
    )
    .option(
      '--dangerously-skip-permissions',
      'Bypass all permission checks. Recommended only for sandboxes with no internet access.',
      () => true,
    )
    .option(
      '--allow-dangerously-skip-permissions',
      'Enable bypassing all permission checks as an option, without it being enabled by default. Recommended only for sandboxes with no internet access.',
      () => true,
    )
    .option(
      '--max-budget-usd <amount>',
      'Maximum dollar amount to spend on API calls (only works with --print)',
      String,
    )
    .option(
      '--include-partial-messages',
      'Include partial message chunks as they arrive (only works with --print and --output-format=stream-json)',
      () => true,
    )
    .option(
      '--replay-user-messages',
      'Re-emit user messages from stdin back on stdout for acknowledgment (only works with --input-format=stream-json and --output-format=stream-json)',
      () => true,
    )
    .option(
      '--allowedTools, --allowed-tools <tools...>',
      'Comma or space-separated list of tool names to allow (e.g. "Bash(git:*) Edit")',
    )
    .option(
      '--tools <tools...>',
      'Specify the list of available tools from the built-in set. Use "" to disable all tools, "default" to use all tools, or specify tool names (e.g. "Bash,Edit,Read"). Only works with --print mode.',
    )
    .option(
      '--disallowedTools, --disallowed-tools <tools...>',
      'Comma or space-separated list of tool names to deny (e.g. "Bash(git:*) Edit")',
    )
    .option(
      '--mcp-config <configs...>',
      'Load MCP servers from JSON files or strings (space-separated)',
    )
    .option('--system-prompt <prompt>', 'System prompt to use for the session')
    .option(
      '--append-system-prompt <prompt>',
      'Append a system prompt to the default system prompt',
    )
    .option(
      '--permission-mode <mode>',
      'Permission mode to use for the session (choices: "acceptEdits", "bypassPermissions", "default", "delegate", "dontAsk", "plan")',
      String,
    )
    .option(
      '--permission-prompt-tool <tool>',
      'Permission prompt tool (only works with --print, --output-format=stream-json, and --input-format=stream-json): "stdio"',
      String,
    )
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
    .option(
      '--plugin-dir <paths...>',
      'Load plugins from directories for this session only (repeatable)',
      (value, previous: string[] | undefined) => {
        const prev = Array.isArray(previous) ? previous : []
        const next = Array.isArray(value) ? value : [value]
        return [...prev, ...next].filter(Boolean)
      },
      [],
    )
    .option(
      '--model <model>',
      "Model for the current session. Provide an alias for the latest model (e.g. 'sonnet' or 'opus') or a model's full name.",
      String,
    )
    .option(
      '--agent <agent>',
      "Agent for the current session. Overrides the 'agent' setting.",
      String,
    )
    .option(
      '--betas <betas...>',
      'Beta headers to include in API requests (API key users only)',
    )
    .option(
      '--fallback-model <model>',
      'Enable automatic fallback to specified model when default model is overloaded (only works with --print)',
      String,
    )
    .option(
      '--settings <file-or-json>',
      'Path to a settings JSON file or a JSON string to load additional settings from',
      String,
    )
    .option(
      '--add-dir <directories...>',
      'Additional directories to allow tool access to',
    )
    .option(
      '--ide',
      'Automatically connect to IDE on startup if exactly one valid IDE is available',
      () => true,
    )
    .option(
      '--strict-mcp-config',
      'Only use MCP servers from --mcp-config, ignoring all other MCP configurations',
      () => true,
    )
    .option(
      '--agents <json>',
      `JSON object defining custom agents (e.g. '{"reviewer": {"description": "Reviews code", "prompt": "You are a code reviewer"}}')`,
      String,
    )
    .option(
      '--setting-sources <sources>',
      'Comma-separated list of setting sources to load (user, project, local).',
      String,
    )
    .option(
      '-r, --resume [value]',
      'Resume a conversation by session ID or session name (omit value to open selector)',
    )
    .option(
      '-c, --continue',
      'Continue the most recent conversation',
      () => true,
    )
    .option(
      '--fork-session',
      'When resuming/continuing, create a new session ID instead of reusing the original (use with --resume or --continue)',
      () => true,
    )
    .option(
      '--no-session-persistence',
      'Disable session persistence - sessions will not be saved to disk and cannot be resumed (only works with --print)',
    )
    .option(
      '--session-id <uuid>',
      'Use a specific session ID for the conversation (must be a valid UUID)',
      String,
    )
    .action(
      async (
        prompt,
        {
          cwd,
          debug,
          verbose,
          enableArchitect,
          print,
          outputFormat,
          jsonSchema,
          inputFormat,
          mcpDebug,
          dangerouslySkipPermissions,
          allowDangerouslySkipPermissions,
          maxBudgetUsd,
          includePartialMessages,
          replayUserMessages,
          allowedTools,
          tools: cliTools,
          disallowedTools,
          mcpConfig,
          systemPrompt: systemPromptOverride,
          appendSystemPrompt,
          permissionMode,
          permissionPromptTool,
          safe,
          disableSlashCommands,
          pluginDir,
          model,
          addDir,
          strictMcpConfig,
          agents,
          settingSources,
          resume,
          continue: continueConversation,
          forkSession,
          sessionId,
          sessionPersistence,
        },
      ) => {
        try {
          setEnabledSettingSourcesFromCli(settingSources)
        } catch (err) {
          process.stderr.write(
            `Error processing --setting-sources: ${err instanceof Error ? err.message : String(err)}\n`,
          )
          process.exit(1)
        }

        setFlagAgentsFromCliJson(agents)
        clearAgentCache()
        clearOutputStyleCache()

        await setup(cwd, safe)
        await showSetupScreens(safe, print)

        assertMinVersion()

        {
          const requested =
            Array.isArray(pluginDir) && pluginDir.length > 0 ? pluginDir : []
          const { listEnabledInstalledPluginPackRoots } =
            await import('@services/skillMarketplace')
          const installed = listEnabledInstalledPluginPackRoots()

          const all = [...installed, ...requested].filter(Boolean)
          const deduped = Array.from(new Set(all))

          if (deduped.length > 0) {
            const { configureSessionPlugins } =
              await import('@services/pluginRuntime')
            const { errors } = await configureSessionPlugins({
              pluginDirs: deduped,
            })
            for (const err of errors) {
              console.warn(err)
            }
          }
        }

        const [{ ask }, { getTools }, { getCommands }] = await Promise.all([
          import('@app/ask'),
          import('@tools'),
          import('@commands'),
        ])
        const commands = await getCommands()

        const mcpClientsPromise =
          (Array.isArray(mcpConfig) && mcpConfig.length > 0) ||
          strictMcpConfig === true
            ? getClientsForCliMcpConfig({
                mcpConfig: Array.isArray(mcpConfig) ? mcpConfig : [],
                strictMcpConfig: strictMcpConfig === true,
                projectDir: cwd,
              })
            : getClients()

        const [allTools, mcpClients] = await Promise.all([
          getTools(
            enableArchitect ?? getCurrentProjectConfig().enableArchitectTool,
          ),
          mcpClientsPromise,
        ])
        decorateToolsForCli()
        const tools =
          disableSlashCommands === true
            ? allTools.filter(t => t.name !== 'SlashCommand')
            : allTools
        const inputPrompt = [prompt, stdinContent].filter(Boolean).join('\n')

        const {
          loadKodeAgentSessionMessages,
          findMostRecentKodeAgentSessionId,
        } = await import('@utils/protocol/kodeAgentSessionLoad')
        const { listKodeAgentSessions, resolveResumeSessionIdentifier } =
          await import('@utils/protocol/kodeAgentSessionResume')
        const { isUuid } = await import('@utils/text/uuid')
        const { setKodeAgentSessionId, getKodeAgentSessionId } =
          await import('@utils/protocol/kodeAgentSessionId')
        const { randomUUID } = await import('crypto')

        const wantsContinue = Boolean(continueConversation)
        const wantsResume = resume !== undefined
        const wantsFork = Boolean(forkSession)

        if (sessionId && !isUuid(String(sessionId))) {
          console.error(`Error: --session-id must be a valid UUID`)
          process.exit(1)
        }

        if (sessionId && (wantsContinue || wantsResume) && !wantsFork) {
          console.error(
            `Error: --session-id can only be used with --continue or --resume if --fork-session is also specified.`,
          )
          process.exit(1)
        }

        let initialMessages: any[] | undefined
        let resumedFromSessionId: string | null = null
        let needsResumeSelector = false

        if (wantsContinue) {
          const latest = findMostRecentKodeAgentSessionId(cwd)
          if (!latest) {
            console.error('No conversation found to continue')
            process.exit(1)
          }
          initialMessages = loadKodeAgentSessionMessages({
            cwd,
            sessionId: latest,
          })
          resumedFromSessionId = latest
        } else if (wantsResume) {
          if (resume === true) {
            needsResumeSelector = true
          } else {
            const identifier = String(resume)
            const resolved = resolveResumeSessionIdentifier({ cwd, identifier })
            if (resolved.kind === 'ok') {
              initialMessages = loadKodeAgentSessionMessages({
                cwd,
                sessionId: resolved.sessionId,
              })
              resumedFromSessionId = resolved.sessionId
            } else if (resolved.kind === 'different_directory') {
              console.error(
                resolved.otherCwd
                  ? `Error: That session belongs to a different directory: ${resolved.otherCwd}`
                  : `Error: That session belongs to a different directory.`,
              )
              process.exit(1)
            } else if (resolved.kind === 'ambiguous') {
              console.error(
                `Error: Multiple sessions match "${identifier}": ${resolved.matchingSessionIds.join(
                  ', ',
                )}`,
              )
              process.exit(1)
            } else {
              console.error(
                `No conversation found with session ID or name: ${identifier}`,
              )
              process.exit(1)
            }
          }
        }

        if (needsResumeSelector && print) {
          console.error(
            'Error: --resume without a value requires interactive mode (no --print).',
          )
          process.exit(1)
        }

        if (!needsResumeSelector) {
          const effectiveSessionId = (() => {
            if (resumedFromSessionId) {
              if (wantsFork) return sessionId ? String(sessionId) : randomUUID()
              return resumedFromSessionId
            }
            if (sessionId) return String(sessionId)
            return getKodeAgentSessionId()
          })()

          setKodeAgentSessionId(effectiveSessionId)
        }

        if (print) {
          await runPrintMode({
            prompt,
            stdinContent,
            inputPrompt,
            cwd,
            safe,
            verbose,
            outputFormat,
            inputFormat,
            jsonSchema,
            permissionPromptTool,
            replayUserMessages,
            cliTools,
            tools,
            commands,
            ask,
            initialMessages,
            sessionPersistence,
            systemPromptOverride,
            appendSystemPrompt,
            disableSlashCommands,
            allowedTools,
            disallowedTools,
            addDir,
            permissionMode,
            dangerouslySkipPermissions,
            allowDangerouslySkipPermissions,
            model,
            mcpClients,
          })
          return
        } else {
          if (sessionPersistence === false) {
            console.error(
              'Error: --no-session-persistence only works with --print',
            )
            process.exit(1)
          }

          const updateInfo = await (async () => {
            try {
              const [
                { getLatestVersion, getUpdateCommandSuggestions },
                semverMod,
              ] = await Promise.all([
                import('@utils/session/autoUpdater'),
                import('semver'),
              ])
              const semver: any = (semverMod as any)?.default ?? semverMod
              const gt = semver?.gt
              if (typeof gt !== 'function')
                return {
                  version: null as string | null,
                  commands: null as string[] | null,
                }

              const latest = await getLatestVersion()
              if (latest && gt(latest, MACRO.VERSION)) {
                const cmds = await getUpdateCommandSuggestions()
                return { version: latest as string, commands: cmds as string[] }
              }
            } catch {}
            return {
              version: null as string | null,
              commands: null as string[] | null,
            }
          })()

          if (needsResumeSelector) {
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
                  debug={Boolean(debug)}
                  disableSlashCommands={disableSlashCommands === true}
                  mcpClients={mcpClients}
                  initialPrompt={inputPrompt}
                  forkSession={wantsFork}
                  forkSessionId={sessionId ? String(sessionId) : null}
                  initialUpdateVersion={updateInfo.version}
                  initialUpdateCommands={updateInfo.commands}
                />,
                renderContextWithExitOnCtrlC,
              )
              context.unmount = unmount
            })()
            return
          }

          const isDefaultModel = await isDefaultSlowAndCapableModel()

          {
            const { render } = await import('ink')
            const { REPL } = await import('@screens/REPL')
            render(
              <REPL
                commands={commands}
                debug={Boolean(debug)}
                disableSlashCommands={disableSlashCommands === true}
                initialPrompt={inputPrompt}
                messageLogName={dateToFilename(new Date())}
                shouldShowPromptInput={true}
                verbose={verbose}
                tools={tools}
                safeMode={safe}
                mcpClients={mcpClients}
                isDefaultModel={isDefaultModel}
                initialUpdateVersion={updateInfo.version}
                initialUpdateCommands={updateInfo.commands}
                initialMessages={initialMessages}
              />,
              renderContext,
            )
          }
        }
      },
    )
    .version(MACRO.VERSION, '-v, --version')

  registerConfigCommands(program)
  registerModelCommands(program)
  registerAgentCommands(program)
  registerPluginCommands(program)
  registerSkillCommands(program)
  registerApprovedToolsCommands(program)
  registerMcpCommands(program)
  registerDoctorCommand(program)
  registerUpdateCommand(program)
  registerLogCommands(program, renderContextWithExitOnCtrlC)
  registerResumeCommand(program, renderContextWithExitOnCtrlC)
  registerContextCommands(program)

  await program.parseAsync(process.argv)
  return program
}

async function stdin() {
  if (process.stdin.isTTY) {
    return ''
  }

  let data = ''
  for await (const chunk of process.stdin) data += chunk
  return data
}

let isGracefulExitInProgress = false
async function gracefulExit(code = 0) {
  if (isGracefulExitInProgress) {
    process.exit(code)
    return
  }
  isGracefulExitInProgress = true

  try {
    const { runSessionEndHooks } = await import('@utils/session/kodeHooks')
    const { getKodeAgentSessionId } =
      await import('@utils/protocol/kodeAgentSessionId')
    const { join } = await import('path')
    const { getSessionOutputDir } =
      await import('@utils/session/sessionTempDir')

    const sessionId = getKodeAgentSessionId()
    const transcriptPath = join(
      getSessionOutputDir(),
      'kode-hooks-transcripts',
      `${sessionId}.transcript.txt`,
    )

    const { signal, cleanup } = (() => {
      if (
        typeof AbortSignal !== 'undefined' &&
        typeof (AbortSignal as any).timeout === 'function'
      ) {
        return {
          signal: (AbortSignal as any).timeout(5000) as AbortSignal,
          cleanup: () => {},
        }
      }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 5000)
      return { signal: controller.signal, cleanup: () => clearTimeout(timer) }
    })()

    try {
      await runSessionEndHooks({
        reason: 'exit',
        cwd: cwd(),
        transcriptPath,
        signal,
      })
    } finally {
      cleanup()
    }
  } catch {}

  try {
    resetCursor()
  } catch {}
  try {
    BunShell.getInstance().close()
  } catch {}
  process.exit(code)
}

let didInstallProcessHandlers = false
export function installProcessHandlers(): void {
  if (didInstallProcessHandlers) return
  didInstallProcessHandlers = true

  process.on('exit', () => {
    resetCursor()
    BunShell.getInstance().close()
  })

  process.on('SIGINT', () => void gracefulExit(0))
  process.on('SIGTERM', () => void gracefulExit(0))
  process.on('SIGBREAK', () => void gracefulExit(0))
  process.on('unhandledRejection', err => {
    console.error('Unhandled rejection:', err)
    void gracefulExit(1)
  })
  process.on('uncaughtException', err => {
    console.error('Uncaught exception:', err)
    void gracefulExit(1)
  })
}

function resetCursor() {
  const terminal = process.stderr.isTTY
    ? process.stderr
    : process.stdout.isTTY
      ? process.stdout
      : undefined
  terminal?.write(`\u001B[?25h${cursorShow}`)
}
