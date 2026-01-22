import { statSync } from 'fs'
import { mkdir } from 'fs/promises'
import { dirname, extname, join, parse, relative } from 'path'
import { z } from 'zod'
import type { Tool, ValidationResult, ToolUseContext } from '@tool'
import { normalizeFilePath } from '@utils/fs/file'
import { getCwd } from '@utils/state'
import {
  hasReadPermission,
  hasWritePermission,
} from '@utils/permissions/filesystem'
import { execFileNoThrow } from '@utils/system/execFileNoThrow'
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

const inputSchema = z.strictObject({
  inputPath: z.string().describe('Input CSV/JSON/JSONL file path'),
  outputPath: z
    .string()
    .optional()
    .describe(
      'Output Parquet file path (default: same name with .parquet extension)',
    ),
  compression: z
    .enum(['snappy', 'gzip', 'zstd', 'none'])
    .optional()
    .default('zstd')
    .describe('Compression algorithm (zstd recommended)'),
  rowGroupSize: z
    .number()
    .optional()
    .default(100000)
    .describe('Number of rows per row group'),
  cleanData: z
    .boolean()
    .optional()
    .default(false)
    .describe('Clean data during conversion (trim strings, remove nulls)'),
})

type Input = z.infer<typeof inputSchema>

type Output = {
  inputFile: string
  outputFile: string
  compression: string
  rowGroupSize: number
  cleanData: boolean
  executionTimeMs: number
}

type InputFormat = 'csv' | 'json' | 'jsonl'

type QueryResult = Record<string, unknown>[]

type ColumnInfo = {
  name: string
  type: string
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''")
}

function escapeIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

function inferInputFormat(filePath: string): InputFormat | null {
  const ext = extname(filePath).toLowerCase()
  if (ext === '.csv') return 'csv'
  if (ext === '.json') return 'json'
  if (ext === '.jsonl' || ext === '.ndjson') return 'jsonl'
  return null
}

function buildSourceExpression(filePath: string, format: InputFormat): string {
  const escapedPath = escapeSqlString(filePath)
  if (format === 'csv') {
    return `read_csv_auto('${escapedPath}')`
  }
  return `read_json_auto('${escapedPath}')`
}

function resolveOutputPath(inputPath: string, outputPath?: string): string {
  if (outputPath) return normalizeFilePath(outputPath)
  const parsed = parse(inputPath)
  return join(parsed.dir, `${parsed.name}.parquet`)
}

function isStringType(type: string): boolean {
  const upper = type.toUpperCase()
  return (
    upper.includes('CHAR') ||
    upper.includes('STRING') ||
    upper.includes('TEXT') ||
    upper.includes('VARCHAR')
  )
}

function buildCopyOptions(compression: string, rowGroupSize: number): string {
  const options = ['FORMAT PARQUET']
  if (compression && compression !== 'none') {
    options.push(`COMPRESSION ${compression.toUpperCase()}`)
  } else {
    options.push('COMPRESSION UNCOMPRESSED')
  }
  if (rowGroupSize > 0) {
    options.push(`ROW_GROUP_SIZE ${rowGroupSize}`)
  }
  return options.join(', ')
}

function run(conn: any, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    conn.run(sql, err => {
      if (err) {
        reject(err)
        return
      }
      resolve()
    })
  })
}

async function runDuckDbCli(sql: string, abortSignal?: AbortSignal): Promise<void> {
  const result = await execFileNoThrow(
    'duckdb',
    [':memory:', '-c', sql],
    abortSignal,
  )

  if (result.code !== 0) {
    const message = result.stderr || 'DuckDB CLI execution failed'
    throw new Error(message.trim())
  }
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

async function getColumns(
  conn: any,
  viewName: string,
): Promise<ColumnInfo[]> {
  const rows = await runAll(conn, `PRAGMA table_info('${viewName}')`)
  return rows.map(row => ({
    name: String(row.name),
    type: String(row.type),
  }))
}

async function buildCleanSelect(
  conn: any,
  sourceExpression: string,
  viewName: string,
): Promise<string> {
  await run(conn, `CREATE TEMP VIEW ${viewName} AS SELECT * FROM ${sourceExpression}`)
  const columns = await getColumns(conn, viewName)
  if (columns.length === 0) {
    return `SELECT * FROM ${viewName}`
  }

  const selectList = columns
    .map(col => {
      const escapedName = escapeIdentifier(col.name)
      if (isStringType(col.type)) {
        return `TRIM(${escapedName}) AS ${escapedName}`
      }
      return escapedName
    })
    .join(', ')

  const nonNullClause = columns
    .map(col => `${escapeIdentifier(col.name)} IS NOT NULL`)
    .join(' OR ')

  return `SELECT ${selectList} FROM ${viewName} WHERE ${nonNullClause}`
}

async function convertToParquet(input: Input): Promise<Output> {
  const startTime = Date.now()
  const inputPath = normalizeFilePath(input.inputPath)
  const outputPath = resolveOutputPath(inputPath, input.outputPath)
  const format = inferInputFormat(inputPath)
  const compression = input.compression ?? 'zstd'
  const rowGroupSize = input.rowGroupSize ?? 100000

  if (!format) {
    throw new Error('Only CSV, JSON, or JSONL files are supported for conversion')
  }

  await mkdir(dirname(outputPath), { recursive: true })

  const duckdb = await tryLoadDuckDb()
  const sourceExpression = buildSourceExpression(inputPath, format)
  const options = buildCopyOptions(compression, rowGroupSize)
  const outputEscaped = escapeSqlString(outputPath)

  if (!duckdb) {
    if (input.cleanData) {
      throw new Error(
        'cleanData requires the DuckDB module. Install \"duckdb\" or disable cleanData.',
      )
    }
    const copySql = `COPY (SELECT * FROM ${sourceExpression}) TO '${outputEscaped}' (${options})`
    await runDuckDbCli(copySql)
    return {
      inputFile: inputPath,
      outputFile: outputPath,
      compression,
      rowGroupSize,
      cleanData: input.cleanData || false,
      executionTimeMs: Date.now() - startTime,
    }
  }

  const db = new duckdb.Database(':memory:')
  const conn = db.connect()
  let viewName: string | null = null

  try {
    let selectSql = `SELECT * FROM ${sourceExpression}`

    if (input.cleanData) {
      viewName = `input_${Date.now()}_${Math.floor(Math.random() * 10000)}`
      selectSql = await buildCleanSelect(conn, sourceExpression, viewName)
    }

    const copySql = `COPY (${selectSql}) TO '${outputEscaped}' (${options})`
    await run(conn, copySql)

    return {
      inputFile: inputPath,
      outputFile: outputPath,
      compression,
      rowGroupSize,
      cleanData: input.cleanData || false,
      executionTimeMs: Date.now() - startTime,
    }
  } finally {
    if (viewName) {
      try {
        await run(conn, `DROP VIEW IF EXISTS ${viewName}`)
      } catch {}
    }
    conn.close()
    db.close()
  }
}

export const ConvertToParquetTool: Tool<typeof inputSchema, Output> = {
  name: 'ConvertToParquet',
  async description() {
    return 'Convert CSV/JSON/JSONL files to Parquet for faster analysis'
  },
  async prompt() {
    return `Convert CSV, JSON, or JSONL files to Parquet using DuckDB.

Guidelines:
- Use for files larger than 100MB
- Parquet is faster and smaller than CSV/JSON
- Use zstd compression for best size/performance

Example:
ConvertToParquet({
  inputPath: '/data/sales.csv',
  outputPath: '/data/sales.parquet',
  compression: 'zstd'
})`
  },
  inputSchema,
  isReadOnly() {
    return false
  },
  isConcurrencySafe() {
    return false
  },
  userFacingName() {
    return 'ConvertToParquet'
  },
  async isEnabled() {
    return true
  },
  needsPermissions({ inputPath, outputPath }) {
    const fullInput = normalizeFilePath(inputPath)
    const fullOutput = resolveOutputPath(fullInput, outputPath)
    return !hasReadPermission(fullInput) || !hasWritePermission(fullOutput)
  },
  async validateInput(
    { inputPath, outputPath, rowGroupSize }: Input,
    _context?: ToolUseContext,
  ): Promise<ValidationResult> {
    const fullInput = normalizeFilePath(inputPath)
    const fullOutput = resolveOutputPath(fullInput, outputPath)

    if (!inputPath.trim()) {
      return { result: false, message: 'Input path cannot be empty' }
    }

    try {
      const stat = statSync(fullInput)
      if (!stat.isFile()) {
        return { result: false, message: 'Input path must point to a file' }
      }
    } catch {
      return { result: false, message: 'Input file does not exist or is not readable' }
    }

    const inputExt = extname(fullInput).toLowerCase()
    if (inputExt === '.parquet') {
      return {
        result: false,
        message: 'Input file is already Parquet. Use AnalyzeLocalFile to query it directly.',
      }
    }

    if (!inferInputFormat(fullInput)) {
      return {
        result: false,
        message: 'Only CSV, JSON, or JSONL files are supported for conversion',
      }
    }

    if (fullInput === fullOutput) {
      return {
        result: false,
        message: 'Output path must be different from input path',
      }
    }

    if (extname(fullOutput).toLowerCase() !== '.parquet') {
      return {
        result: false,
        message: 'Output path must end with .parquet',
      }
    }

    if (rowGroupSize !== undefined && rowGroupSize <= 0) {
      return {
        result: false,
        message: 'Row group size must be a positive number',
      }
    }

    return { result: true }
  },
  renderToolUseMessage({ inputPath, outputPath, compression }: Input, { verbose }) {
    const fullInput = normalizeFilePath(inputPath)
    const fullOutput = resolveOutputPath(fullInput, outputPath)
    const displayInput = verbose ? fullInput : relative(getCwd(), fullInput)
    const displayOutput = verbose ? fullOutput : relative(getCwd(), fullOutput)
    return `ConvertToParquet: ${displayInput} -> ${displayOutput} (${compression || 'zstd'})`
  },
  renderResultForAssistant(output: Output): string {
    return `Converted ${output.inputFile} to ${output.outputFile} (${output.compression}) in ${output.executionTimeMs}ms.`
  },
  async *call(input: Input, { abortController }) {
    try {
      const fullInput = normalizeFilePath(input.inputPath)
      const fullOutput = resolveOutputPath(fullInput, input.outputPath)
      if (abortController.signal.aborted) {
        yield {
          type: 'result' as const,
          data: {
            inputFile: fullInput,
            outputFile: fullOutput,
            compression: input.compression || 'zstd',
            rowGroupSize: input.rowGroupSize || 100000,
            cleanData: input.cleanData || false,
            executionTimeMs: 0,
          },
          resultForAssistant: 'Conversion cancelled',
        }
        return
      }

      const result = await convertToParquet(input)

      yield {
        type: 'result' as const,
        data: result,
        resultForAssistant: this.renderResultForAssistant(result),
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      const fullInput = normalizeFilePath(input.inputPath)
      const fullOutput = resolveOutputPath(fullInput, input.outputPath)
      const errorResult: Output = {
        inputFile: fullInput,
        outputFile: fullOutput,
        compression: input.compression || 'zstd',
        rowGroupSize: input.rowGroupSize || 100000,
        cleanData: input.cleanData || false,
        executionTimeMs: 0,
      }

      yield {
        type: 'result' as const,
        data: errorResult,
        resultForAssistant: `Conversion failed: ${errorMessage}`,
      }
    }
  },
}
