import { z } from 'zod'
import type { Tool, ValidationResult, ToolUseContext } from '@tool'
import {
  getDataSourceClient,
  listDataSources,
  type SchemaInfo,
  type TableInfo,
  type ColumnInfo,
  type DataSourceSummary,
} from '@services/datasource'
import { PROMPT } from './prompt'

export const inputSchema = z.strictObject({
  datasource: z
    .string()
    .optional()
    .describe('Data source name (omit to list all sources)'),
  table: z
    .string()
    .optional()
    .describe('Specific table name to get detailed schema'),
  schema: z
    .string()
    .optional()
    .describe('Database schema/namespace (defaults to public/default)'),
  pattern: z
    .string()
    .optional()
    .describe('Table name pattern for filtering (e.g., "user_%")'),
  limit: z
    .number()
    .optional()
    .default(100)
    .describe('Maximum number of tables to return (default: 100)'),
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
      () => reject(new Error(`Operation timed out after ${timeoutMs}ms`)),
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
type SchemaInfoWithSource = SchemaInfo & { datasource: string }
type Output =
  | { type: 'sources'; sources: DataSourceSummary[] }
  | { type: 'schema'; datasource: string; schema: SchemaInfoWithSource; truncated: boolean }

function matchesPattern(tableName: string, pattern?: string): boolean {
  if (!pattern) return true
  const regex = new RegExp('^' + pattern.replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i')
  return regex.test(tableName)
}

async function exploreSchema(
  datasource: string,
  tableName?: string,
  schemaName?: string,
  pattern?: string,
  limit: number = 100,
): Promise<SchemaInfoWithSource> {
  const client = await getDataSourceClient(datasource)
  let tables: TableInfo[] = []

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
      let query = `SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = $1 AND table_type = 'BASE TABLE'`

      if (pattern) {
        query += ` AND table_name LIKE $2`
      }

      query += ` ORDER BY table_name LIMIT $${pattern ? '3' : '2'}`

      const params = pattern
        ? [targetSchema, pattern.replace(/%/g, '%').replace(/_/g, '_'), limit]
        : [targetSchema, limit]

      const tablesResult = await client.client.query(query, params)

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
      let query = `SELECT TABLE_NAME
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`

      if (pattern) {
        query += ` AND TABLE_NAME LIKE ?`
      }

      query += ` ORDER BY TABLE_NAME LIMIT ?`

      const params = pattern ? [database, pattern, limit] : [database, limit]
      const [tablesRows] = await client.client.query(query, params)

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
      let query = `SELECT name FROM system.tables WHERE database = '${database}'`

      if (pattern) {
        query += ` AND name LIKE '${pattern}'`
      }

      query += ` ORDER BY name LIMIT ${limit}`

      const result = await client.client.query({
        query,
        format: 'JSONEachRow',
      })

      const tablesRows = (await result.json()) as any[]
      for (const row of tablesRows) {
        tables.push({
          name: row.name,
          schema: database,
          columns: [],
        })
      }
    }
  } else if (client.type === 'databricks') {
    const catalog = client.config.catalog || 'main'
    const targetSchema = schemaName || client.config.schema || 'default'

    if (tableName) {
      const result = await executeDatabricksQuery(
        client.client,
        `DESCRIBE TABLE ${catalog}.${targetSchema}.${tableName}`,
      )

      const columns: ColumnInfo[] = []
      for (const row of result.rows) {
        const name = getRowString(row, ['col_name', 'column_name', 'name'])
        if (!name || name.startsWith('#')) continue
        const type = getRowString(row, ['data_type', 'type']) || 'unknown'
        const comment = getRowString(row, ['comment'])
        columns.push({
          name,
          type,
          nullable: true,
          comment: comment || undefined,
        })
      }

      tables.push({
        name: tableName,
        schema: `${catalog}.${targetSchema}`,
        columns,
      })
    } else {
      const result = await executeDatabricksQuery(
        client.client,
        `SHOW TABLES IN ${catalog}.${targetSchema}`,
      )

      let allTables = result.rows
        .map(row => getRowString(row, ['tableName', 'table_name', 'name']))
        .filter((name): name is string => Boolean(name))

      if (pattern) {
        allTables = allTables.filter(name => matchesPattern(name, pattern))
      }

      allTables = allTables.slice(0, limit)

      for (const name of allTables) {
        tables.push({
          name,
          schema: `${catalog}.${targetSchema}`,
          columns: [],
        })
      }
    }
  }

  return { datasource, tables }
}

function getRowString(
  row: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

async function executeDatabricksQuery(
  client: {
    host: string
    accessToken: string
    httpPath: string
    catalog?: string
    schema?: string
  },
  sql: string,
): Promise<{ columns: string[]; rows: Record<string, unknown>[] }> {
  const url = `${client.host}/api/2.0/sql/statements`

  const requestBody: Record<string, unknown> = {
    statement: sql,
    warehouse_id: extractWarehouseId(client.httpPath),
    wait_timeout: '30s',
    disposition: 'INLINE',
  }

  if (client.catalog) {
    requestBody.catalog = client.catalog
  }
  if (client.schema) {
    requestBody.schema = client.schema
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${client.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Databricks API error (${response.status}): ${errorText}`)
  }

  const result = (await response.json()) as {
    status?: { state?: string }
    manifest?: { schema?: { columns?: Array<{ name: string }> } }
    result?: { data_array?: unknown[][] }
  }

  if (result.status?.state !== 'SUCCEEDED') {
    throw new Error(`Query failed with state: ${result.status?.state}`)
  }

  const schemaColumns = result.manifest?.schema?.columns || []
  const columns = schemaColumns.map(col => col.name)
  const dataArray = result.result?.data_array || []

  const rows = dataArray.map(row => {
    const rowObj: Record<string, unknown> = {}
    columns.forEach((col, idx) => {
      rowObj[col] = row[idx]
    })
    return rowObj
  })

  return { columns, rows }
}

function extractWarehouseId(httpPath: string): string {
  const match = httpPath.match(/\/warehouses\/([^/]+)/)
  if (!match) {
    throw new Error(
      `Invalid http_path format: ${httpPath}. Expected format: /sql/1.0/warehouses/{warehouse_id}`,
    )
  }
  return match[1]
}

export const InspectDatabaseTool: Tool<typeof inputSchema, Output> = {
  name: 'InspectDatabase',
  async description() {
    return 'Inspect database: list data sources, explore schemas, view table structures'
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
    return 'InspectDatabase'
  },
  async isEnabled() {
    return true
  },
  needsPermissions(): boolean {
    return false
  },
  async validateInput(
    { datasource, table, limit }: Input,
    _context?: ToolUseContext,
  ): Promise<ValidationResult> {
    if (table && !datasource) {
      return {
        result: false,
        message: 'datasource is required when specifying a table',
      }
    }

    if (limit !== undefined && (limit <= 0 || limit > 10000)) {
      return {
        result: false,
        message: 'limit must be between 1 and 10000',
      }
    }

    return { result: true }
  },
  renderToolUseMessage(input: Input, { verbose }) {
    if (!input.datasource) {
      return 'InspectDatabase: List all data sources'
    }
    if (input.table) {
      return `InspectDatabase: ${input.datasource}.${input.table} schema`
    }
    const parts = [input.datasource]
    if (input.pattern) parts.push(`pattern="${input.pattern}"`)
    if (input.limit && input.limit !== 100) parts.push(`limit=${input.limit}`)
    return `InspectDatabase: ${parts.join(', ')}`
  },
  renderResultForAssistant(output: Output): string {
    if (output.type === 'sources') {
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

      return `Available data sources:\n${sourceList}\n\nUse InspectDatabase with datasource parameter to explore tables.`
    }

    const { schema, truncated } = output
    const { datasource, tables } = schema

    if (tables.length === 0) {
      return `No tables found in ${datasource}.`
    }

    if (tables[0].columns.length > 0) {
      const table = tables[0]
      const colLines = table.columns.map(col => {
        const parts = [col.name, col.type]
        if (col.isPrimaryKey) parts.push('PK')
        if (!col.nullable) parts.push('NOT NULL')
        if (col.comment) parts.push(`// ${col.comment}`)
        return `  - ${parts.join(' ')}`
      })
      return `Table: ${table.schema}.${table.name}\n${colLines.join('\n')}`
    }

    const tableList = tables.map(t => `- ${t.name}`).join('\n')
    const suffix = truncated ? `\n\n(Showing first ${tables.length} tables. Use pattern or specify a table for details.)` : ''
    return `Tables in ${datasource}:\n${tableList}${suffix}`
  },
  async *call(input: Input, { abortController }) {
    try {
      if (!input.datasource) {
        const sources = listDataSources()
        yield {
          type: 'result' as const,
          data: { type: 'sources' as const, sources },
          resultForAssistant: this.renderResultForAssistant({ type: 'sources', sources }),
        }
        return
      }

      const schema = await withTimeout(
        exploreSchema(
          input.datasource,
          input.table,
          input.schema,
          input.pattern,
          input.limit || 100,
        ),
        input.timeout || DEFAULT_TIMEOUT,
      )

      const truncated = !input.table && schema.tables.length === (input.limit || 100)

      yield {
        type: 'result' as const,
        data: { type: 'schema' as const, datasource: input.datasource, schema, truncated },
        resultForAssistant: this.renderResultForAssistant({
          type: 'schema',
          datasource: input.datasource,
          schema,
          truncated,
        }),
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      yield {
        type: 'result' as const,
        data: input.datasource
          ? { type: 'schema' as const, datasource: input.datasource, schema: { datasource: input.datasource, tables: [] }, truncated: false }
          : { type: 'sources' as const, sources: [] },
        resultForAssistant: `Error: ${errorMessage}`,
      }
    }
  },
}
