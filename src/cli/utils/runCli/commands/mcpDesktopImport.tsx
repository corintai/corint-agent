import React from 'react'
import { Command } from '@commander-js/extra-typings'

import type { McpServerConfig } from '@utils/config'
import { addMcpServer, ensureConfigScope, getMcpServer } from '@services/mcpClient'

export function registerMcpDesktopImportCommand(mcp: Command): void {
  mcp
    .command('add-from-claude-desktop')
    .description(
      'Import MCP servers from a desktop MCP host config (macOS, Windows and WSL)',
    )
    .option(
      '-s, --scope <scope>',
      'Configuration scope (project, global, or mcprc)',
      'project',
    )
    .action(async options => {
      try {
        const scope = ensureConfigScope(options.scope)
        const platform = process.platform

        const { existsSync, readFileSync } = await import('fs')
        const { join } = await import('path')
        const { exec } = await import('child_process')

        const isWSL =
          platform === 'linux' &&
          existsSync('/proc/version') &&
          readFileSync('/proc/version', 'utf-8')
            .toLowerCase()
            .includes('microsoft')

        if (platform !== 'darwin' && platform !== 'win32' && !isWSL) {
          console.error(
            'Error: This command is only supported on macOS, Windows, and WSL',
          )
          process.exit(1)
        }

        let configPath
        if (platform === 'darwin') {
          configPath = join(
            process.env.HOME || '~',
            'Library/Application Support/Claude/claude_desktop_config.json',
          )
        } else if (platform === 'win32') {
          configPath = join(
            process.env.APPDATA || '',
            'Claude/claude_desktop_config.json',
          )
        } else if (isWSL) {
          const whoamiCommand = await new Promise<string>((resolve, reject) => {
            exec(
              'powershell.exe -Command "whoami"',
              (err: Error, stdout: string) => {
                if (err) reject(err)
                else resolve(stdout.trim().split('\\').pop() || '')
              },
            )
          })

          configPath = `/mnt/c/Users/${whoamiCommand}/AppData/Roaming/Claude/claude_desktop_config.json`
        }

        if (!existsSync(configPath)) {
          console.error(`Error: Config file not found at ${configPath}`)
          process.exit(1)
        }

        let config
        try {
          const configContent = readFileSync(configPath, 'utf-8')
          config = JSON.parse(configContent)
        } catch (err) {
          console.error(`Error reading config file: ${err}`)
          process.exit(1)
        }

        const mcpServers = config.mcpServers || {}
        const serverNames = Object.keys(mcpServers)
        const numServers = serverNames.length

        if (numServers === 0) {
          console.log('No MCP servers found in the desktop config')
          process.exit(0)
        }

        const serversInfo = serverNames.map(name => {
          const server = mcpServers[name]
          let description = ''

          switch (server.type) {
            case 'http':
              description = `HTTP: ${server.url}`
              break
            case 'sse':
              description = `SSE: ${server.url}`
              break
            case 'sse-ide':
              description = `SSE-IDE (${server.ideName}): ${server.url}`
              break
            case 'ws':
              description = `WS: ${server.url}`
              break
            case 'ws-ide':
              description = `WS-IDE (${server.ideName}): ${server.url}`
              break
            case 'stdio':
            default:
              description = `stdio: ${server.command} ${(server.args || []).join(' ')}`
              break
          }

          return { name, description, server }
        })

        const ink = await import('ink')
        const reactModule = await import('react')
        const inkjsui = await import('@inkjs/ui')
        const utilsTheme = await import('@utils/theme')

        const { render } = ink
        const React = reactModule
        const { MultiSelect } = inkjsui
        const { Box, Text } = ink
        const { getTheme } = utilsTheme

        await new Promise<void>(resolve => {
          function ClaudeDesktopImport() {
            const { useState } = reactModule
            const [isFinished, setIsFinished] = useState(false)
            const [importResults, setImportResults] = useState(
              [] as { name: string; success: boolean }[],
            )
            const [isImporting, setIsImporting] = useState(false)
            const theme = getTheme()

            const importServers = async (selectedServers: string[]) => {
              setIsImporting(true)
              const results = []

              for (const name of selectedServers) {
                try {
                  const server = mcpServers[name]

                  const existingServer = getMcpServer(name)
                  if (existingServer) {
                    continue
                  }

                  addMcpServer(name, server as McpServerConfig, scope)
                  results.push({ name, success: true })
                } catch (err) {
                  results.push({ name, success: false })
                }
              }

              setImportResults(results)
              setIsImporting(false)
              setIsFinished(true)

              setTimeout(() => {
                resolve()
              }, 1000)
            }

            const handleConfirm = async (selectedServers: string[]) => {
              const existingServers = selectedServers.filter(name =>
                getMcpServer(name),
              )

              if (existingServers.length > 0) {
                const results = []

                const newServers = selectedServers.filter(
                  name => !getMcpServer(name),
                )
                for (const name of newServers) {
                  try {
                    const server = mcpServers[name]
                    addMcpServer(name, server as McpServerConfig, scope)
                    results.push({ name, success: true })
                  } catch (err) {
                    results.push({ name, success: false })
                  }
                }

                for (const name of existingServers) {
                  try {
                    const server = mcpServers[name]
                    addMcpServer(name, server as McpServerConfig, scope)
                    results.push({ name, success: true })
                  } catch (err) {
                    results.push({ name, success: false })
                  }
                }

                setImportResults(results)
                setIsImporting(false)
                setIsFinished(true)

                setTimeout(() => {
                  resolve()
                }, 1000)
              } else {
                await importServers(selectedServers)
              }
            }

            return (
              <Box flexDirection="column" padding={1}>
                <Box
                  flexDirection="column"
                  borderStyle="round"
                  borderColor={theme.kode}
                  padding={1}
                  width={'100%'}
                >
                  <Text bold color={theme.kode}>
                    Import MCP Servers from Desktop Config
                  </Text>

                  <Box marginY={1}>
                    <Text>
                      Found {numServers} MCP servers in the desktop config.
                    </Text>
                  </Box>

                  <Text>Please select the servers you want to import:</Text>

                  <Box marginTop={1}>
                    <MultiSelect
                      options={serverNames.map(name => ({
                        label: name,
                        value: name,
                      }))}
                      defaultValue={serverNames}
                      onSubmit={handleConfirm}
                    />
                  </Box>
                </Box>

                <Box marginTop={0} marginLeft={3}>
                  <Text dimColor>
                    Space to select · Enter to confirm · Esc to cancel
                  </Text>
                </Box>

                {isFinished && (
                  <Box marginTop={1}>
                    <Text color={theme.success}>
                      Successfully imported{' '}
                      {importResults.filter(r => r.success).length} MCP server
                      to local config.
                    </Text>
                  </Box>
                )}
              </Box>
            )
          }

          const { unmount } = render(<ClaudeDesktopImport />)

          setTimeout(() => {
            unmount()
            resolve()
          }, 30000)
        })

        process.exit(0)
      } catch (error) {
        console.error(`Error: ${(error as Error).message}`)
        process.exit(1)
      }
    })
}
