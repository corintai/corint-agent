import * as React from 'react'
import { Box, Text } from 'ink'
import { z } from 'zod'
import type { Tool, ValidationResult, ToolUseContext } from '@tool'
import { FallbackToolUseRejectedMessage } from '@components/FallbackToolUseRejectedMessage'
import { getTheme } from '@utils/theme'
import {
  getDataSourceClient,
  listDataSources,
  type SchemaInfo,
  type TableInfo,
  type ColumnInfo,
} from '@services/datasource'

export const inputSchema = z.strictObject({
  datasource: z
    .string()
    .describe('Name of the data source to explore'),
  table: z
    .string()
    .optional()
    .describe('Specific table name to get detailed schema (optional)'),
  schema: z
    .string()
    .optional()
    .describe('Database schema/namespace to explore (optional, defaults to public/default)'),
})

type Input = z.infer<typeof inputSchema>
type Output = SchemaInfo

async function exploreSchema(
  datasource: string,
  tableName?: string,
  schemaName?: string,
): Promise<SchemaInfo> {
  const client = await getDataSourceClient(datasource)
  const tables: TableInfo[] = []

  if (client.type === 'postgres') {
    const targetSchema = schemaName || 'public'

    if (tableName) {
      const columnsResult = await client.client.query(
        `SELECT
          column_name,
          data_type,
          is_nullable,
          column_default,
          col_description((table_schema || '.' || table_name)::regclass, ordinal_position) as comment
        FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position`,
        [targetSchema, tableName],
      )

      const pkResult = await client.client.query(
        `SELECT a.attname
        FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = ($1 || '.' || $2)::regclass AND i.indisprimary`,
        [targetSchema, tableName],
      )
      const pkColumns = new Set(pkResult.rows.map(r => r.attname))

      const columns: ColumnInfo[] = columnsResult.rows.map(row => ({
        name: row.column_name,
        type: row.data_type,
        nullable: row.is_nullable === 'YES',
        isPrimaryKey: pkColumns.has(row.column_name),
        defaultValue: row.column_default,
        comment: row.comment,
      }))

      tables.push({
        name: tableName,
        schema: targetSchema,
        columns,
      })
    } else {
      const tablesResult = await client.client.query(
        `SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = $1 AND table_type = 'BASE TABLE'
        ORDER BY table_name`,
        [targetSchema],
      )

      for (const row of tablesResult.rows) {
        tables.push({
          name: row.table_name,
          schema: targetSchema,
          columns: [],
        })
      }
    }
  } else if (client.type === 'mysql') {
    const database = client.config.database || schemaName

    if (tableName) {
      const [columnsRows] = await client.client.query(
        `SELECT
          COLUMN_NAME,
          DATA_TYPE,
          IS_NULLABLE,
          COLUMN_KEY,
          COLUMN_DEFAULT,
          COLUMN_COMMENT
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION`,
        [database, tableName],
      )

      const columns: ColumnInfo[] = (columnsRows as any[]).map(row => ({
        name: row.COLUMN_NAME,
        type: row.DATA_TYPE,
        nullable: row.IS_NULLABLE === 'YES',
        isPrimaryKey: row.COLUMN_KEY === 'PRI',
        defaultValue: row.COLUMN_DEFAULT,
        comment: row.COLUMN_COMMENT,
      }))

      tables.push({
        name: tableName,
        schema: database,
        columns,
      })
    } else {
      const [tablesRows] = await client.client.query(
        `SELECT TABLE_NAME
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_NAME`,
        [database],
      )

      for (const row of tablesRows as any[]) {
        tables.push({
          name: row.TABLE_NAME,
          schema: database,
          columns: [],
        })
      }
    }
  } else if (client.type === 'clickhouse') {
    const database = schemaName || client.config.database || 'default'

    if (tableName) {
      const result = await client.client.query({
        query: `SELECT
          name,
          type,
          default_kind,
          default_expression,
          comment
        FROM system.columns
        WHERE database = '${database}' AND table = '${tableName}'
        ORDER BY position`,
        format: 'JSONEachRow',
      })

      const columnsRows = (await result.json()) as any[]
      const columns: ColumnInfo[] = columnsRows.map((row: any) => ({
        name: row.name,
        type: row.type,
        nullable: row.type.startsWith('Nullable'),
        defaultValue: row.default_expression || undefined,
        comment: row.comment,
      }))

      tables.push({
        name: tableName,
        schema: database,
        columns,
      })
    } else {
      const result = await client.client.query({
        query: `SELECT name FROM system.tables WHERE database = '${database}' ORDER BY name`,
        format: 'JSONEachRow',
      })

      const tablesRows = (await result.json()) as { name: string }[]
      for (const row of tablesRows) {
        tables.push({
          name: row.name,
          schema: database,
          columns: [],
        })
      }
    }
  }

  return { tables }
}

export const ExploreSchemaTool: Tool<typeof inputSchema, Output> = {
  name: 'ExploreSchema',
  async description() {
    return 'Explore database schema - list tables or get detailed column information'
  },
  async prompt() {
    const sources = listDataSources()
    const sourceList =
      sources.length > 0
        ? sources.map(s => `- ${s.name} (${s.type})`).join('\n')
        : 'No data sources configured'

    return `Explore database schema to understand table structures.

Available data sources:
${sourceList}

Usage:
- List all tables: ExploreSchema(datasource="risk_db")
- Get table details: ExploreSchema(datasource="risk_db", table="applications")
- Explore specific schema: ExploreSchema(datasource="risk_db", schema="analytics")

This tool helps you understand the database structure before writing queries.`
  },
  isReadOnly() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  inputSchema,
  userFacingName() {
    return 'ExploreSchema'
  },
  async isEnabled() {
    return true
  },
  needsPermissions(): boolean {
    return true
  },
  async validateInput(
    { datasource }: Input,
    _context?: ToolUseContext,
  ): Promise<ValidationResult> {
    if (!datasource.trim()) {
      return { result: false, message: 'Data source name cannot be empty' }
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

  renderToolUseMessage({ datasource, table, schema }: Input, { verbose }) {
    const theme = getTheme()
    const target = table
      ? `${datasource}.${schema || 'default'}.${table}`
      : `${datasource}${schema ? '.' + schema : ''}`

    return (
      <Box flexDirection="row">
        <Text bold color="cyan">
          ExploreSchema:{' '}
        </Text>
        <Text color={theme.secondaryText}>{target}</Text>
      </Box>
    )
  },

  renderToolResultMessage(content: Output, { verbose }) {
    const theme = getTheme()

    if (content.tables.length === 0) {
      return (
        <Box>
          <Text color={theme.secondaryText}>No tables found</Text>
        </Box>
      )
    }

    const hasColumns = content.tables.some(t => t.columns.length > 0)

    if (hasColumns) {
      const table = content.tables[0]
      const columnLines = table.columns
        .slice(0, verbose ? 20 : 5)
        .map(col => {
          const pk = col.isPrimaryKey ? '🔑 ' : '   '
          const nullable = col.nullable ? '' : ' NOT NULL'
          return `${pk}${col.name}: ${col.type}${nullable}`
        })
        .join('\n')

      const moreCount = table.columns.length - (verbose ? 20 : 5)

      return (
        <Box flexDirection="column">
          <Text color="green">
            Table: {table.schema}.{table.name}
          </Text>
          <Text color={theme.text}>{columnLines}</Text>
          {moreCount > 0 && (
            <Text color={theme.secondaryText} dimColor>
              ... and {moreCount} more columns
            </Text>
          )}
        </Box>
      )
    }

    const tableLines = content.tables
      .slice(0, verbose ? 20 : 10)
      .map(t => t.name)
      .join('\n')

    const moreCount = content.tables.length - (verbose ? 20 : 10)

    return (
      <Box flexDirection="column">
        <Text color="green">{content.tables.length} tables found</Text>
        <Text color={theme.text}>{tableLines}</Text>
        {moreCount > 0 && (
          <Text color={theme.secondaryText} dimColor>
            ... and {moreCount} more tables
          </Text>
        )}
      </Box>
    )
  },

  renderResultForAssistant(output: Output): string {
    if (output.tables.length === 0) {
      return 'No tables found in the specified schema.'
    }

    const hasColumns = output.tables.some(t => t.columns.length > 0)

    if (hasColumns) {
      const table = output.tables[0]
      const columnsInfo = table.columns
        .map(col => {
          const parts = [
            col.name,
            col.type,
            col.nullable ? 'NULL' : 'NOT NULL',
          ]
          if (col.isPrimaryKey) parts.push('PRIMARY KEY')
          if (col.defaultValue) parts.push(`DEFAULT ${col.defaultValue}`)
          if (col.comment) parts.push(`-- ${col.comment}`)
          return parts.join(' | ')
        })
        .join('\n')

      return `Table: ${table.schema}.${table.name}\n\nColumns:\n${columnsInfo}`
    }

    const tableList = output.tables.map(t => `- ${t.name}`).join('\n')
    return `Found ${output.tables.length} tables:\n${tableList}`
  },

  renderToolUseRejectedMessage() {
    return <FallbackToolUseRejectedMessage />
  },

  async *call({ datasource, table, schema }: Input, { abortController }) {
    try {
      if (abortController.signal.aborted) {
        yield {
          type: 'result' as const,
          data: { tables: [] },
          resultForAssistant: 'Schema exploration cancelled',
        }
        return
      }

      const result = await exploreSchema(datasource, table, schema)

      yield {
        type: 'result' as const,
        data: result,
        resultForAssistant: this.renderResultForAssistant(result),
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'

      yield {
        type: 'result' as const,
        data: { tables: [] },
        resultForAssistant: `Schema exploration failed: ${errorMessage}`,
      }
    }
  },
}
