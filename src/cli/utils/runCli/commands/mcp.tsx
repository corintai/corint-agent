import { existsSync } from 'node:fs'
import { Command } from '@commander-js/extra-typings'
import { cwd } from 'process'

import { PRODUCT_COMMAND, PRODUCT_NAME } from '@constants/product'
import {
  getCurrentProjectConfig,
  getGlobalConfig,
  getProjectMcpServerDefinitions,
  saveCurrentProjectConfig,
} from '@utils/config'
import {
  addMcpServer,
  ensureConfigScope,
  getClients,
  getMcprcServerStatus,
  getMcpServer,
  listMCPServers,
  parseEnvVars,
  removeMcpServer,
} from '@services/mcpClient'
import {
  looksLikeMcpUrl,
  normalizeMcpScopeForCli,
  normalizeMcpTransport,
  parseMcpHeaders,
} from '@services/mcpCliUtils'
import { startMCPServer } from '../../../../entrypoints/mcp'
import { setup } from '../../setup'
import { registerMcpDesktopImportCommand } from './mcpDesktopImport'

export function registerMcpCommands(program: Command): void {
  const mcp = program
    .command('mcp')
    .description('Configure and manage MCP servers')

  mcp
    .command('serve')
    .description(`Start the ${PRODUCT_NAME} MCP server`)
    .action(async () => {
      const providedCwd = (program.opts() as { cwd?: string }).cwd ?? cwd()

      if (!existsSync(providedCwd)) {
        console.error(`Error: Directory ${providedCwd} does not exist`)
        process.exit(1)
      }

      try {
        await setup(providedCwd, false)
        await startMCPServer(providedCwd)
      } catch (error) {
        console.error('Error: Failed to start MCP server:', error)
        process.exit(1)
      }
    })

  mcp
    .command('add-sse <name> <url>')
    .description('Add an SSE server')
    .option(
      '-s, --scope <scope>',
      'Configuration scope (local, user, or project)',
      'local',
    )
    .option(
      '-H, --header <header...>',
      'Set headers (e.g. -H "X-Api-Key: abc123" -H "X-Custom: value")',
    )
    .action(async (name, url, options) => {
      try {
        const scopeInfo = normalizeMcpScopeForCli(options.scope)
        const headers = parseMcpHeaders(options.header)

        addMcpServer(
          name,
          { type: 'sse', url, ...(headers ? { headers } : {}) },
          scopeInfo.scope,
        )
        console.log(
          `Added SSE MCP server ${name} with URL: ${url} to ${scopeInfo.display} config`,
        )
        if (headers) {
          console.log(`Headers: ${JSON.stringify(headers, null, 2)}`)
        }
        process.exit(0)
      } catch (error) {
        console.error((error as Error).message)
        process.exit(1)
      }
    })

  mcp
    .command('add-http <name> <url>')
    .description('Add a Streamable HTTP MCP server')
    .option(
      '-s, --scope <scope>',
      'Configuration scope (local, user, or project)',
      'local',
    )
    .option(
      '-H, --header <header...>',
      'Set headers (e.g. -H "X-Api-Key: abc123" -H "X-Custom: value")',
    )
    .action(async (name, url, options) => {
      try {
        const scopeInfo = normalizeMcpScopeForCli(options.scope)
        const headers = parseMcpHeaders(options.header)
        addMcpServer(
          name,
          { type: 'http', url, ...(headers ? { headers } : {}) },
          scopeInfo.scope,
        )
        console.log(
          `Added HTTP MCP server ${name} with URL: ${url} to ${scopeInfo.display} config`,
        )
        if (headers) {
          console.log(`Headers: ${JSON.stringify(headers, null, 2)}`)
        }
        process.exit(0)
      } catch (error) {
        console.error((error as Error).message)
        process.exit(1)
      }
    })

  mcp
    .command('add-ws <name> <url>')
    .description('Add a WebSocket MCP server')
    .option(
      '-s, --scope <scope>',
      'Configuration scope (local, user, or project)',
      'local',
    )
    .action(async (name, url, options) => {
      try {
        const scopeInfo = normalizeMcpScopeForCli(options.scope)
        addMcpServer(name, { type: 'ws', url }, scopeInfo.scope)
        console.log(
          `Added WebSocket MCP server ${name} with URL ${url} to ${scopeInfo.display} config`,
        )
        process.exit(0)
      } catch (error) {
        console.error((error as Error).message)
        process.exit(1)
      }
    })

  mcp
    .command('add [name] [commandOrUrl] [args...]')
    .description('Add a server (run without arguments for interactive wizard)')
    .option(
      '-s, --scope <scope>',
      'Configuration scope (local, user, or project)',
      'local',
    )
    .option(
      '-t, --transport <transport>',
      'MCP transport (stdio, sse, or http)',
    )
    .option(
      '-H, --header <header...>',
      'Set headers (e.g. -H "X-Api-Key: abc123" -H "X-Custom: value")',
    )
    .option(
      '-e, --env <env...>',
      'Set environment variables (e.g. -e KEY=value)',
    )
    .action(async (name, commandOrUrl, args, options) => {
      try {
        if (!name) {
          console.log('Interactive wizard mode: Enter the server details')
          const { createInterface } = await import('readline')
          const rl = createInterface({
            input: process.stdin,
            output: process.stdout,
          })

          const question = (query: string) =>
            new Promise<string>(resolve => rl.question(query, resolve))

          const serverName = await question('Server name: ')
          if (!serverName) {
            console.error('Error: Server name is required')
            rl.close()
            process.exit(1)
          }

          const serverType = await question(
            'Server type (stdio, http, sse, ws) [stdio]: ',
          )
          const type =
            serverType && ['stdio', 'http', 'sse', 'ws'].includes(serverType)
              ? serverType
              : 'stdio'

          const prompt = type === 'stdio' ? 'Command: ' : 'URL: '
          const commandOrUrlValue = await question(prompt)
          if (!commandOrUrlValue) {
            console.error(
              `Error: ${type === 'stdio' ? 'Command' : 'URL'} is required`,
            )
            rl.close()
            process.exit(1)
          }

          let serverArgs: string[] = []
          let serverEnv: Record<string, string> = {}

          if (type === 'stdio') {
            const argsStr = await question(
              'Command arguments (space-separated): ',
            )
            serverArgs = argsStr ? argsStr.split(' ').filter(Boolean) : []

            const envStr = await question(
              'Environment variables (format: KEY1=value1,KEY2=value2): ',
            )
            if (envStr) {
              const envPairs = envStr.split(',').map(pair => pair.trim())
              serverEnv = parseEnvVars(envPairs.map(pair => pair))
            }
          }

          const scopeStr = await question(
            'Configuration scope (local, user, or project) [local]: ',
          )
          const scopeInfo = normalizeMcpScopeForCli(scopeStr)
          const serverScope = scopeInfo.scope

          rl.close()

          if (type === 'http') {
            addMcpServer(
              serverName,
              { type: 'http', url: commandOrUrlValue },
              serverScope,
            )
            console.log(
              `Added HTTP MCP server ${serverName} with URL ${commandOrUrlValue} to ${scopeInfo.display} config`,
            )
          } else if (type === 'sse') {
            addMcpServer(
              serverName,
              { type: 'sse', url: commandOrUrlValue },
              serverScope,
            )
            console.log(
              `Added SSE MCP server ${serverName} with URL ${commandOrUrlValue} to ${scopeInfo.display} config`,
            )
          } else if (type === 'ws') {
            addMcpServer(
              serverName,
              { type: 'ws', url: commandOrUrlValue },
              serverScope,
            )
            console.log(
              `Added WebSocket MCP server ${serverName} with URL ${commandOrUrlValue} to ${scopeInfo.display} config`,
            )
          } else {
            addMcpServer(
              serverName,
              {
                type: 'stdio',
                command: commandOrUrlValue,
                args: serverArgs,
                env: serverEnv,
              },
              serverScope,
            )

            console.log(
              `Added stdio MCP server ${serverName} with command: ${commandOrUrlValue} ${serverArgs.join(' ')} to ${scopeInfo.display} config`,
            )
          }
        } else if (name && commandOrUrl) {
          const scopeInfo = normalizeMcpScopeForCli(options.scope)
          const transportInfo = normalizeMcpTransport(options.transport)

          if (transportInfo.transport === 'stdio') {
            if (options.header?.length) {
              throw new Error(
                '--header can only be used with --transport http or --transport sse',
              )
            }

            const env = parseEnvVars(options.env)
            if (!transportInfo.explicit && looksLikeMcpUrl(commandOrUrl)) {
              console.warn(
                `Warning: "${commandOrUrl}" looks like a URL. Default transport is stdio, so it will be treated as a command.`,
              )
              console.warn(
                `If you meant to add an HTTP MCP server, run: ${PRODUCT_COMMAND} mcp add ${name} ${commandOrUrl} --transport http`,
              )
              console.warn(
                `If you meant to add a legacy SSE MCP server, run: ${PRODUCT_COMMAND} mcp add ${name} ${commandOrUrl} --transport sse`,
              )
            }

            addMcpServer(
              name,
              { type: 'stdio', command: commandOrUrl, args: args || [], env },
              scopeInfo.scope,
            )

            console.log(
              `Added stdio MCP server ${name} with command: ${commandOrUrl} ${(args || []).join(' ')} to ${scopeInfo.display} config`,
            )
          } else {
            if (options.env?.length) {
              throw new Error('--env is only supported for stdio MCP servers')
            }
            if (args?.length) {
              throw new Error(
                'Unexpected arguments. URL-based MCP servers do not accept command args.',
              )
            }

            const headers = parseMcpHeaders(options.header)
            addMcpServer(
              name,
              {
                type: transportInfo.transport,
                url: commandOrUrl,
                ...(headers ? { headers } : {}),
              },
              scopeInfo.scope,
            )

            const kind = transportInfo.transport.toUpperCase()
            console.log(
              `Added ${kind} MCP server ${name} with URL: ${commandOrUrl} to ${scopeInfo.display} config`,
            )
            if (headers) {
              console.log(`Headers: ${JSON.stringify(headers, null, 2)}`)
            }
          }
        } else {
          console.error(
            'Error: Missing required arguments. Either provide no arguments for interactive mode or specify name and command/URL.',
          )
          process.exit(1)
        }

        process.exit(0)
      } catch (error) {
        console.error((error as Error).message)
        process.exit(1)
      }
    })

  mcp
    .command('remove <name>')
    .description('Remove an MCP server')
    .option(
      '-s, --scope <scope>',
      'Configuration scope (local, user, or project)',
    )
    .action(async (name: string, options: { scope?: string }) => {
      try {
        if (options.scope) {
          const scopeInfo = normalizeMcpScopeForCli(options.scope)
          removeMcpServer(name, scopeInfo.scope)
          console.log(
            `Removed MCP server ${name} from ${scopeInfo.display} config`,
          )
          process.exit(0)
        }

        const matches: Array<{
          scope: ReturnType<typeof ensureConfigScope>
          display: string
        }> = []

        const projectConfig = getCurrentProjectConfig()
        if (projectConfig.mcpServers?.[name]) {
          matches.push({
            scope: ensureConfigScope('project'),
            display: 'local',
          })
        }

        const globalConfig = getGlobalConfig()
        if (globalConfig.mcpServers?.[name]) {
          matches.push({ scope: ensureConfigScope('global'), display: 'user' })
        }

        const projectFileDefinitions = getProjectMcpServerDefinitions()
        if (projectFileDefinitions.servers[name]) {
          const source = projectFileDefinitions.sources[name]
          if (source === '.mcp.json') {
            matches.push({
              scope: ensureConfigScope('mcpjson'),
              display: 'project',
            })
          } else {
            matches.push({
              scope: ensureConfigScope('mcprc'),
              display: 'mcprc',
            })
          }
        }

        if (matches.length === 0) {
          throw new Error(`No MCP server found with name: ${name}`)
        }

        if (matches.length > 1) {
          console.error(
            `MCP server "${name}" exists in multiple scopes: ${matches
              .map(m => m.display)
              .join(', ')}`,
          )
          console.error('Please specify which scope to remove from:')
          for (const match of matches) {
            console.error(
              `  ${PRODUCT_COMMAND} mcp remove ${name} --scope ${match.display}`,
            )
          }
          process.exit(1)
        }

        const match = matches[0]!
        removeMcpServer(name, match.scope)
        console.log(`Removed MCP server ${name} from ${match.display} config`)
        process.exit(0)
      } catch (error) {
        console.error((error as Error).message)
        process.exit(1)
      }
    })

  mcp
    .command('list')
    .description('List configured MCP servers')
    .action(async () => {
      try {
        const servers = listMCPServers()
        if (Object.keys(servers).length === 0) {
          console.log(
            `No MCP servers configured. Use \`${PRODUCT_COMMAND} mcp add\` to add a server.`,
          )
          process.exit(0)
        }

        const projectFileServers = getProjectMcpServerDefinitions()
        const clients = await getClients()
        const clientByName = new Map<string, (typeof clients)[number]>()
        for (const client of clients) {
          clientByName.set(client.name, client)
        }

        const names = Object.keys(servers).sort((a, b) => a.localeCompare(b))
        for (const name of names) {
          const server = servers[name]!

          const client = clientByName.get(name)
          const status =
            client?.type === 'connected'
              ? 'connected'
              : client?.type === 'failed'
                ? 'failed'
                : projectFileServers.servers[name]
                  ? (() => {
                      const approval = getMcprcServerStatus(name)
                      if (approval === 'pending') return 'pending'
                      if (approval === 'rejected') return 'rejected'
                      return 'disconnected'
                    })()
                  : 'disconnected'

          const summary = (() => {
            switch (server.type) {
              case 'http':
                return `${server.url} (http)`
              case 'sse':
                return `${server.url} (sse)`
              case 'sse-ide':
                return `${server.url} (sse-ide)`
              case 'ws':
                return `${server.url} (ws)`
              case 'ws-ide':
                return `${server.url} (ws-ide)`
              case 'stdio':
              default:
                return `${server.command} ${(server.args || []).join(' ')} (stdio)`
            }
          })()

          console.log(`${name}: ${summary} [${status}]`)
        }

        process.exit(0)
      } catch (error) {
        console.error((error as Error).message)
        process.exit(1)
      }
    })

  mcp
    .command('add-json <name> <json>')
    .description('Add an MCP server with a JSON string')
    .option(
      '-s, --scope <scope>',
      'Configuration scope (project, global, or mcprc)',
      'project',
    )
    .action(async (name, jsonStr, options) => {
      try {
        const scope = ensureConfigScope(options.scope)

        let serverConfig
        try {
          serverConfig = JSON.parse(jsonStr)
        } catch (e) {
          console.error('Error: Invalid JSON string')
          process.exit(1)
        }

        if (
          !serverConfig.type ||
          !['stdio', 'sse', 'http', 'ws', 'sse-ide', 'ws-ide'].includes(
            serverConfig.type,
          )
        ) {
          console.error(
            'Error: Server type must be one of: "stdio", "http", "sse", "ws", "sse-ide", "ws-ide"',
          )
          process.exit(1)
        }

        if (
          ['sse', 'http', 'ws', 'sse-ide', 'ws-ide'].includes(
            serverConfig.type,
          ) &&
          !serverConfig.url
        ) {
          console.error('Error: URL-based MCP servers must have a URL')
          process.exit(1)
        }

        if (serverConfig.type === 'stdio' && !serverConfig.command) {
          console.error('Error: stdio server must have a command')
          process.exit(1)
        }

        if (
          ['sse-ide', 'ws-ide'].includes(serverConfig.type) &&
          !serverConfig.ideName
        ) {
          console.error('Error: IDE MCP servers must include ideName')
          process.exit(1)
        }

        addMcpServer(name, serverConfig, scope)

        switch (serverConfig.type) {
          case 'http':
            console.log(
              `Added HTTP MCP server ${name} with URL ${serverConfig.url} to ${scope} config`,
            )
            break
          case 'sse':
            console.log(
              `Added SSE MCP server ${name} with URL ${serverConfig.url} to ${scope} config`,
            )
            break
          case 'sse-ide':
            console.log(
              `Added SSE-IDE MCP server ${name} with URL ${serverConfig.url} to ${scope} config`,
            )
            break
          case 'ws':
            console.log(
              `Added WS MCP server ${name} with URL ${serverConfig.url} to ${scope} config`,
            )
            break
          case 'ws-ide':
            console.log(
              `Added WS-IDE MCP server ${name} with URL ${serverConfig.url} to ${scope} config`,
            )
            break
          case 'stdio':
          default:
            console.log(
              `Added stdio MCP server ${name} with command: ${serverConfig.command} ${(
                serverConfig.args || []
              ).join(' ')} to ${scope} config`,
            )
            break
        }

        process.exit(0)
      } catch (error) {
        console.error((error as Error).message)
        process.exit(1)
      }
    })

  mcp
    .command('get <name>')
    .description('Get details about an MCP server')
    .action(async (name: string) => {
      try {
        const server = getMcpServer(name)
        if (!server) {
          console.error(`No MCP server found with name: ${name}`)
          process.exit(1)
        }

        const projectFileServers = getProjectMcpServerDefinitions()
        const clients = await getClients()
        const client = clients.find(c => c.name === name)

        const status =
          client?.type === 'connected'
            ? 'connected'
            : client?.type === 'failed'
              ? 'failed'
              : projectFileServers.servers[name]
                ? (() => {
                    const approval = getMcprcServerStatus(name)
                    if (approval === 'pending') return 'pending'
                    if (approval === 'rejected') return 'rejected'
                    return 'disconnected'
                  })()
                : 'disconnected'

        const scopeDisplay = (() => {
          switch (server.scope) {
            case 'project':
              return 'local'
            case 'global':
              return 'user'
            case 'mcpjson':
              return 'project'
            case 'mcprc':
              return 'mcprc'
            default:
              return server.scope
          }
        })()

        console.log(`${name}:`)
        console.log(`  Status: ${status}`)
        console.log(`  Scope: ${scopeDisplay}`)

        const printHeaders = (headers: Record<string, string> | undefined) => {
          if (!headers || Object.keys(headers).length === 0) return
          console.log('  Headers:')
          for (const [key, value] of Object.entries(headers)) {
            console.log(`    ${key}: ${value}`)
          }
        }

        switch (server.type) {
          case 'http':
            console.log(`  Type: http`)
            console.log(`  URL: ${server.url}`)
            printHeaders(server.headers)
            break
          case 'sse':
            console.log(`  Type: sse`)
            console.log(`  URL: ${server.url}`)
            printHeaders(server.headers)
            break
          case 'sse-ide':
            console.log(`  Type: sse-ide`)
            console.log(`  URL: ${server.url}`)
            console.log(`  IDE: ${server.ideName}`)
            printHeaders(server.headers)
            break
          case 'ws':
            console.log(`  Type: ws`)
            console.log(`  URL: ${server.url}`)
            break
          case 'ws-ide':
            console.log(`  Type: ws-ide`)
            console.log(`  URL: ${server.url}`)
            console.log(`  IDE: ${server.ideName}`)
            break
          case 'stdio':
          default:
            console.log(`  Type: stdio`)
            console.log(`  Command: ${server.command}`)
            console.log(`  Args: ${(server.args || []).join(' ')}`)
            if (server.env) {
              console.log('  Environment:')
              for (const [key, value] of Object.entries(server.env)) {
                console.log(`    ${key}=${value}`)
              }
            }
            break
        }
        process.exit(0)
      } catch (error) {
        console.error((error as Error).message)
        process.exit(1)
      }
    })

  registerMcpDesktopImportCommand(mcp)

  const resetMcpChoices = () => {
    const config = getCurrentProjectConfig()
    saveCurrentProjectConfig({
      ...config,
      approvedMcprcServers: [],
      rejectedMcprcServers: [],
    })
    console.log(
      'All project-file MCP server approvals/rejections (.mcp.json/.mcprc) have been reset.',
    )
    console.log(
      `You will be prompted for approval next time you start ${PRODUCT_NAME}.`,
    )
    process.exit(0)
  }

  mcp
    .command('reset-project-choices')
    .description(
      'Reset approvals for project-file MCP servers (.mcp.json/.mcprc) in this project',
    )
    .action(() => {
      resetMcpChoices()
    })

  mcp
    .command('reset-mcprc-choices')
    .description(
      'Reset approvals for project-file MCP servers (.mcp.json/.mcprc) in this project',
    )
    .action(() => {
      resetMcpChoices()
    })
}
