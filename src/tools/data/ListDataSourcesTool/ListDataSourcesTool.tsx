import * as React from 'react'
import { Box, Text } from 'ink'
import { z } from 'zod'
import type { Tool } from '@tool'
import { FallbackToolUseRejectedMessage } from '@components/FallbackToolUseRejectedMessage'
import { getTheme } from '@utils/theme'
import { listDataSources, type DataSourceSummary } from '@services/datasource'

export const inputSchema = z.strictObject({})

type Output = {
  sources: DataSourceSummary[]
}

export const ListDataSourcesTool: Tool<typeof inputSchema, Output> = {
  name: 'ListDataSources',
  async description() {
    return 'List all configured data sources available for querying'
  },
  async prompt() {
    return `List all configured data sources.

This tool shows all available database connections that can be used with QuerySQL and ExploreSchema tools.

Data sources can be configured via:
- repository/datasource.yaml file
- CORINT_DATA_SOURCES environment variable (JSON)
- CORINT_DS_<NAME>_TYPE environment variables

Use this tool first to discover available data sources before running queries.`
  },
  isReadOnly() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  inputSchema,
  userFacingName() {
    return 'ListDataSources'
  },
  async isEnabled() {
    return true
  },
  needsPermissions(): boolean {
    return false
  },

  renderToolUseMessage(_input, { verbose }) {
    return (
      <Box flexDirection="row">
        <Text bold color="cyan">
          ListDataSources
        </Text>
      </Box>
    )
  },

  renderToolResultMessage(content: Output, { verbose }) {
    const theme = getTheme()

    if (content.sources.length === 0) {
      return (
        <Box flexDirection="column">
          <Text color="yellow">No data sources configured</Text>
          <Text color={theme.secondaryText} dimColor>
            Configure via repository/datasource.yaml or CORINT_DATA_SOURCES env
          </Text>
        </Box>
      )
    }

    const sourceLines = content.sources
      .map(s => `• ${s.name} (${s.type})`)
      .join('\n')

    return (
      <Box flexDirection="column">
        <Text color="green">{content.sources.length} data source(s) available</Text>
        <Text color={theme.text}>{sourceLines}</Text>
      </Box>
    )
  },

  renderResultForAssistant(output: Output): string {
    if (output.sources.length === 0) {
      return `No data sources configured.

To configure data sources, create a repository/datasource.yaml file:

\`\`\`yaml
datasource:
  risk_db:
    type: postgres
    host: localhost
    port: 5432
    database: risk_data
    user: \${DB_USER}
    password: \${DB_PASSWORD}
\`\`\`

Or set environment variables:
- CORINT_DS_RISK_DB_TYPE=postgres
- CORINT_DS_RISK_DB_HOST=localhost
- CORINT_DS_RISK_DB_DATABASE=risk_data`
    }

    const sourceList = output.sources
      .map(s => `- ${s.name} (${s.type})`)
      .join('\n')

    return `Available data sources:\n${sourceList}\n\nUse ExploreSchema to view table structures, then QuerySQL to run queries.`
  },

  renderToolUseRejectedMessage() {
    return <FallbackToolUseRejectedMessage />
  },

  async *call(_input, { abortController }) {
    const sources = listDataSources()

    yield {
      type: 'result' as const,
      data: { sources },
      resultForAssistant: this.renderResultForAssistant({ sources }),
    }
  },
}
