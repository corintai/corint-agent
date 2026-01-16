import * as React from 'react'
import { Box, Text } from 'ink'
import { z } from 'zod'
import type { Tool, ValidationResult, ToolUseContext } from '@tool'
import { FallbackToolUseRejectedMessage } from '@components/FallbackToolUseRejectedMessage'
import { getTheme } from '@utils/theme'
import {
  getDataSourceClient,
  listDataSources,
  type QueryResult,
} from '@services/datasource'

export const inputSchema = z.strictObject({
  datasource: z
    .string()
    .describe(
      'Name of the data source to query (e.g., "risk_db", "analytics")',
    ),
  sql: z
    .string()
    .describe(
      'SQL query to execute. Use SELECT for read operations. Avoid destructive operations.',
    ),
  limit: z
    .number()
    .optional()
    .default(100)
    .describe('Maximum number of rows to return (default: 100, max: 1000)'),
  timeout: z
    .number()
    .optional()
    .default(30000)
    .describe('Timeout in milliseconds (default: 30000, max: 300000)'),
})

const DEFAULT_TIMEOUT = 30000
const MAX_TIMEOUT = 300000

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const timeoutMs = Math.min(Math.max(ms, 1000), MAX_TIMEOUT)
  let timeoutId: ReturnType<typeof setTimeout>
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`Query timed out after ${timeoutMs}ms`)),
      timeoutMs,
    )
  })
  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    clearTimeout(timeoutId!)
  }
}

type Input = z.infer<typeof inputSchema>
type Output = QueryResult

async function executeQuery(
  datasource: string,
  sql: string,
  limit: number,
): Promise<QueryResult> {
  const startTime = Date.now()
  const client = await getDataSourceClient(datasource)

  let columns: string[] = []
  let rows: Record<string, unknown>[] = []

  const limitedSql = sql.trim().toLowerCase().startsWith('select')
    ? ensureLimit(sql, limit)
    : sql

  if (client.type === 'postgres') {
    const result = await client.client.query(limitedSql)
    columns = result.fields.map(f => f.name)
    rows = result.rows
  } else if (client.type === 'mysql') {
    const [queryRows, fields] = await client.client.query(limitedSql)
    columns = (fields as { name: string }[]).map(f => f.name)
    rows = queryRows as unknown as Record<string, unknown>[]
  } else if (client.type === 'clickhouse') {
    const result = await client.client.query({
      query: limitedSql,
      format: 'JSONEachRow',
    })
    const jsonRows = (await result.json()) as Record<string, unknown>[]
    rows = jsonRows
    if (rows.length > 0) {
      columns = Object.keys(rows[0])
    }
  } else if (client.type === 'sqlite') {
    const queryRows = client.client.prepare(limitedSql).all() as Record<
      string,
      unknown
    >[]
    rows = queryRows
    if (rows.length > 0) {
      columns = Object.keys(rows[0])
    }
  }

  return {
    columns,
    rows,
    rowCount: rows.length,
    executionTimeMs: Date.now() - startTime,
  }
}

function ensureLimit(sql: string, limit: number): string {
  const upperSql = sql.toUpperCase()
  if (upperSql.includes('LIMIT')) {
    return sql
  }
  return `${sql.trim().replace(/;$/, '')} LIMIT ${Math.min(limit, 1000)}`
}

export const QuerySQLTool: Tool<typeof inputSchema, Output> = {
  name: 'QuerySQL',
  async description() {
    return 'Execute SQL queries against configured data sources'
  },
  async prompt() {
    const sources = listDataSources()
    const sourceList =
      sources.length > 0
        ? sources.map(s => `- ${s.name} (${s.type})`).join('\n')
        : 'No data sources configured'

    return `Execute SQL queries against configured data sources.

Available data sources:
${sourceList}

Guidelines:
- Use SELECT queries for data retrieval
- Always specify a reasonable LIMIT to avoid large result sets
- Use proper table and column names from the schema
- For risk analysis, common tables include: applications, decisions, rules, scores
- Avoid destructive operations (DELETE, DROP, TRUNCATE)

Example usage:
- Query recent applications: SELECT * FROM applications WHERE created_at > NOW() - INTERVAL '7 days' LIMIT 100
- Get rule performance: SELECT rule_id, COUNT(*) as hits FROM rule_hits GROUP BY rule_id`
  },
  isReadOnly() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  inputSchema,
  userFacingName() {
    return 'QuerySQL'
  },
  async isEnabled() {
    return true
  },
  needsPermissions(): boolean {
    return true
  },
  async validateInput(
    { datasource, sql }: Input,
    _context?: ToolUseContext,
  ): Promise<ValidationResult> {
    if (!datasource.trim()) {
      return { result: false, message: 'Data source name cannot be empty' }
    }

    if (!sql.trim()) {
      return { result: false, message: 'SQL query cannot be empty' }
    }

    const upperSql = sql.toUpperCase().trim()
    const destructiveKeywords = [
      'DELETE',
      'DROP',
      'TRUNCATE',
      'ALTER',
      'UPDATE',
    ]
    for (const keyword of destructiveKeywords) {
      if (upperSql.startsWith(keyword)) {
        return {
          result: false,
          message: `Destructive operation "${keyword}" is not allowed. Use SELECT for read operations.`,
        }
      }
    }

    const sources = listDataSources()
    const sourceExists = sources.some(
      s => s.name.toLowerCase() === datasource.toLowerCase(),
    )
    if (!sourceExists && sources.length > 0) {
      return {
        result: false,
        message: `Data source "${datasource}" not found. Available: ${sources.map(s => s.name).join(', ')}`,
      }
    }

    return { result: true }
  },

  renderToolUseMessage({ datasource, sql, limit }: Input, { verbose }) {
    const theme = getTheme()
    const truncatedSql = sql.length > 200 ? sql.substring(0, 200) + '...' : sql

    if (verbose) {
      return (
        <Box flexDirection="column">
          <Text bold color="cyan">
            QuerySQL: {datasource}
          </Text>
          <Box marginTop={1}>
            <Text color={theme.secondaryText}>{sql}</Text>
          </Box>
          <Text color={theme.secondaryText} dimColor>
            Limit: {limit}
          </Text>
        </Box>
      )
    }
    return (
      <Box flexDirection="row">
        <Text bold color="cyan">
          QuerySQL:{' '}
        </Text>
        <Text color={theme.secondaryText}>{truncatedSql}</Text>
      </Box>
    )
  },

  renderToolResultMessage(content: Output, { verbose }) {
    const theme = getTheme()
    const preview = content.rows.slice(0, verbose ? 10 : 3)
    const previewText = preview.map(row => JSON.stringify(row)).join('\n')

    return (
      <Box flexDirection="column">
        <Text color="green">
          ✓ {content.rowCount} rows returned ({content.executionTimeMs}ms)
        </Text>
        {content.columns.length > 0 && (
          <Text color={theme.secondaryText} dimColor>
            Columns: {content.columns.join(', ')}
          </Text>
        )}
        {preview.length > 0 && <Text color={theme.text}>{previewText}</Text>}
        {content.rowCount > preview.length && (
          <Text color={theme.secondaryText} dimColor>
            ... and {content.rowCount - preview.length} more rows
          </Text>
        )}
      </Box>
    )
  },

  renderResultForAssistant(output: Output): string {
    const header = `Query returned ${output.rowCount} rows in ${output.executionTimeMs}ms`
    const columns = `Columns: ${output.columns.join(', ')}`

    if (output.rows.length === 0) {
      return `${header}\n${columns}\n\nNo data returned.`
    }

    const rowsJson = JSON.stringify(output.rows, null, 2)
    return `${header}\n${columns}\n\nData:\n${rowsJson}`
  },

  renderToolUseRejectedMessage() {
    return <FallbackToolUseRejectedMessage />
  },

  async *call({ datasource, sql, limit, timeout }: Input, { abortController }) {
    try {
      if (abortController.signal.aborted) {
        yield {
          type: 'result' as const,
          data: {
            columns: [],
            rows: [],
            rowCount: 0,
            executionTimeMs: 0,
          },
          resultForAssistant: 'Query cancelled',
        }
        return
      }

      const timeoutMs = timeout || DEFAULT_TIMEOUT
      const result = await withTimeout(
        executeQuery(datasource, sql, limit || 100),
        timeoutMs,
      )

      yield {
        type: 'result' as const,
        data: result,
        resultForAssistant: this.renderResultForAssistant(result),
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      const errorResult: Output = {
        columns: [],
        rows: [],
        rowCount: 0,
        executionTimeMs: 0,
      }

      yield {
        type: 'result' as const,
        data: errorResult,
        resultForAssistant: `Query failed: ${errorMessage}`,
      }
    }
  },
}
