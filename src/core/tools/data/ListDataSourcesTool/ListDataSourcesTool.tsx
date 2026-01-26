import { z } from 'zod'
import type { Tool } from '@tool'
import { listDataSources, type DataSourceSummary } from '@services/datasource'
import { PROMPT } from './prompt'

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
    return PROMPT
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
    return 'ListDataSources'
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

  async *call(_input, { abortController }) {
    const sources = listDataSources()

    yield {
      type: 'result' as const,
      data: { sources },
      resultForAssistant: this.renderResultForAssistant({ sources }),
    }
  },
}
