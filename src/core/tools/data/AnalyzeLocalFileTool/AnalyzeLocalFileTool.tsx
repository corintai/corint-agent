import { statSync } from 'fs'
import { extname, relative } from 'path'
import { z } from 'zod'
import type { Tool, ValidationResult, ToolUseContext } from '@tool'
import { normalizeFilePath } from '@utils/fs/file'
import { getCwd } from '@utils/state'
import { hasReadPermission } from '@utils/permissions/filesystem'
import { execFileNoThrow } from '@utils/system/execFileNoThrow'
import { PROMPT } from './prompt'

let duckdbModule: any | null = null
let duckdbLoadError: unknown | null = null

async function tryLoadDuckDb(): Promise<any | null> {
  if (duckdbModule) return duckdbModule
  if (duckdbLoadError) return null
  try {
    const imported = (await import('duckdb')) as any
    duckdbModule = imported.default || imported
    return duckdbModule
  } catch (error) {
    duckdbLoadError = error
    return null
  }
}

const MAX_LIMIT = 1000

const inputSchema = z.strictObject({
  filePath: z
    .string()
    .describe('Absolute path to CSV/Parquet/JSON/JSONL file to analyze'),
  query: z.string().describe('SQL query to execute on the file'),
  limit: z
    .number()
    .optional()
    .default(1000)
    .describe('Maximum number of rows to return (default: 1000, max: 1000)'),
  format: z
    .enum(['csv', 'parquet', 'json', 'jsonl', 'auto'])
    .optional()
    .default('auto')
    .describe('File format (auto-detect by default)'),
})

type Input = z.infer<typeof inputSchema>

type Output = {
  columns: string[]
  rows: Record<string, unknown>[]
  rowCount: number
  executionTimeMs: number
}

type FileFormat = 'csv' | 'parquet' | 'json' | 'jsonl' | 'auto'

type QueryResult = Record<string, unknown>[]

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''")
}

function inferFormat(filePath: string, format: FileFormat): FileFormat {
  if (format !== 'auto') return format
  const ext = extname(filePath).toLowerCase()
  if (ext === '.csv') return 'csv'
  if (ext === '.parquet') return 'parquet'
  if (ext === '.json') return 'json'
  if (ext === '.jsonl' || ext === '.ndjson') return 'jsonl'
  return 'auto'
}

function buildSourceExpression(filePath: string, format: FileFormat): string {
  const escapedPath = escapeSqlString(filePath)
  const detected = inferFormat(filePath, format)
  if (detected === 'csv') {
    return `read_csv_auto('${escapedPath}')`
  }
  if (detected === 'json' || detected === 'jsonl') {
    return `read_json_auto('${escapedPath}')`
  }
  if (detected === 'parquet') {
    return `read_parquet('${escapedPath}')`
  }
  return `'${escapedPath}'`
}

function ensureLimit(sql: string, limit: number): string {
  if (/\bLIMIT\b/i.test(sql)) return sql
  const capped = Math.min(Math.max(limit, 1), MAX_LIMIT)
  return `${sql.trim().replace(/;$/, '')} LIMIT ${capped}`
}

function buildQuery(query: string, sourceExpression: string, limit: number): string {
  const trimmed = query.trim()
  if (!trimmed) {
    return `SELECT * FROM ${sourceExpression} LIMIT ${Math.min(limit, MAX_LIMIT)}`
  }

  const placeholderPattern = /\bfrom\s+(data|file|input)\b/i
  let fullQuery = trimmed

  if (placeholderPattern.test(fullQuery)) {
    fullQuery = fullQuery.replace(placeholderPattern, `FROM ${sourceExpression}`)
  } else if (/\bfrom\b/i.test(fullQuery)) {
    const explicitSourcePattern =
      /\bfrom\s+(?:['"`]|read_csv_auto\(|read_json_auto\(|read_parquet\(|read_csv\(|read_json\()/i
    if (!explicitSourcePattern.test(fullQuery)) {
      fullQuery = fullQuery.replace(
        /\bfrom\s+([`"\[])?[A-Za-z0-9_]+([`"\]]?)/i,
        `FROM ${sourceExpression}`,
      )
    }
  } else {
    fullQuery = `SELECT * FROM ${sourceExpression} ${trimmed}`
  }

  if (/^\s*(select|with)\b/i.test(fullQuery)) {
    fullQuery = ensureLimit(fullQuery, limit)
  }

  return fullQuery
}

function runAll(conn: any, sql: string): Promise<QueryResult> {
  return new Promise((resolve, reject) => {
    conn.all(sql, (err, rows) => {
      if (err) {
        reject(err)
        return
      }
      resolve(rows as QueryResult)
    })
  })
}

async function runDuckDbCli(
  sql: string,
  abortSignal?: AbortSignal,
): Promise<QueryResult> {
  const result = await execFileNoThrow(
    'duckdb',
    ['-json', ':memory:', '-c', sql],
    abortSignal,
  )

  if (result.code !== 0) {
    const message = result.stderr || 'DuckDB CLI execution failed'
    throw new Error(message.trim())
  }

  const trimmed = result.stdout.trim()
  if (!trimmed) return []

  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) {
      return parsed as QueryResult
    }
    return [parsed as Record<string, unknown>]
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown parse error'
    throw new Error(`Failed to parse DuckDB CLI output: ${message}`)
  }
}

async function executeQuery(
  filePath: string,
  query: string,
  limit: number,
  format: FileFormat,
  abortSignal?: AbortSignal,
): Promise<Output> {
  const startTime = Date.now()
  const duckdb = await tryLoadDuckDb()
  const sourceExpression = buildSourceExpression(filePath, format)
  const fullQuery = buildQuery(query, sourceExpression, limit)

  if (!duckdb) {
    const rows = await runDuckDbCli(fullQuery, abortSignal)
    const columns = rows.length > 0 ? Object.keys(rows[0]) : []
    return {
      columns,
      rows,
      rowCount: rows.length,
      executionTimeMs: Date.now() - startTime,
    }
  }

  const db = new duckdb.Database(':memory:')
  const conn = db.connect()

  try {
    const rows = await runAll(conn, fullQuery)
    const columns = rows.length > 0 ? Object.keys(rows[0]) : []

    return {
      columns,
      rows,
      rowCount: rows.length,
      executionTimeMs: Date.now() - startTime,
    }
  } finally {
    conn.close()
    db.close()
  }
}

export const AnalyzeLocalFileTool: Tool<typeof inputSchema, Output> = {
  name: 'AnalyzeLocalFile',
  async description() {
    return 'Analyze local CSV/Parquet/JSON/JSONL files using DuckDB'
  },
  async prompt() {
    return PROMPT
  },
  inputSchema,
  isReadOnly() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  userFacingName() {
    return 'AnalyzeLocalFile'
  },
  async isEnabled() {
    return true
  },
  needsPermissions({ filePath }) {
    const fullPath = normalizeFilePath(filePath)
    return !hasReadPermission(fullPath)
  },
  async validateInput(
    { filePath, query }: Input,
    _context?: ToolUseContext,
  ): Promise<ValidationResult> {
    const fullPath = normalizeFilePath(filePath)

    if (!filePath.trim()) {
      return { result: false, message: 'File path cannot be empty' }
    }

    if (!query.trim()) {
      return { result: false, message: 'SQL query cannot be empty' }
    }

    try {
      const stat = statSync(fullPath)
      if (!stat.isFile()) {
        return { result: false, message: 'File path must point to a file' }
      }
    } catch {
      return { result: false, message: 'File does not exist or is not readable' }
    }

    const upperQuery = query.trim().toUpperCase()
    const destructiveKeywords = [
      'INSERT',
      'UPDATE',
      'DELETE',
      'DROP',
      'ALTER',
      'TRUNCATE',
      'CREATE',
      'COPY',
      'EXPORT',
      'IMPORT',
      'ATTACH',
      'DETACH',
    ]
    for (const keyword of destructiveKeywords) {
      if (upperQuery.startsWith(keyword)) {
        return {
          result: false,
          message: `Destructive operation "${keyword}" is not allowed. Use SELECT for read operations.`,
        }
      }
    }

    return { result: true }
  },
  renderToolUseMessage({ filePath, query, limit }: Input, { verbose }) {
    const truncatedQuery =
      query.length > 200 ? `${query.slice(0, 200)}...` : query
    const fullPath = normalizeFilePath(filePath)
    const displayPath = verbose ? fullPath : relative(getCwd(), fullPath)
    return `AnalyzeLocalFile: ${displayPath} — ${truncatedQuery} (limit: ${limit})`
  },
  renderResultForAssistant(output: Output): string {
    const header = `Query returned ${output.rowCount} rows in ${output.executionTimeMs}ms`
    const columns = output.columns.length
      ? `Columns: ${output.columns.join(', ')}`
      : 'Columns: (none)'

    if (output.rows.length === 0) {
      return `${header}\n${columns}\n\nNo data returned.`
    }

    const rowsJson = JSON.stringify(output.rows, null, 2)
    return `${header}\n${columns}\n\nData:\n${rowsJson}`
  },
  async *call(
    { filePath, query, limit, format }: Input,
    { abortController },
  ) {
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

      const result = await executeQuery(
        normalizeFilePath(filePath),
        query,
        limit || MAX_LIMIT,
        format || 'auto',
        abortController.signal,
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
