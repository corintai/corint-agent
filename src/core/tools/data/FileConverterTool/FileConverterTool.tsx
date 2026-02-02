import { statSync } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
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
import * as XLSX from 'xlsx'
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

const inputSchema = z.strictObject({
  operation: z
    .enum(['to_parquet', 'excel_to_csv'])
    .describe('Conversion operation: to_parquet (CSV/JSON→Parquet) or excel_to_csv (Excel→CSV)'),
  inputPath: z.string().describe('Input file path'),
  outputPath: z
    .string()
    .optional()
    .describe('Output file path (default: same name with new extension)'),
  // Parquet-specific options
  compression: z
    .enum(['snappy', 'gzip', 'zstd', 'none'])
    .optional()
    .default('zstd')
    .describe('Compression for Parquet (zstd recommended)'),
  rowGroupSize: z
    .number()
    .optional()
    .default(100000)
    .describe('Rows per group for Parquet'),
  cleanData: z
    .boolean()
    .optional()
    .default(false)
    .describe('Clean data during Parquet conversion (trim strings, remove nulls)'),
  // Excel-specific options
  sheetName: z
    .string()
    .optional()
    .describe('Sheet name for Excel conversion (default: first sheet)'),
  convertAllSheets: z
    .boolean()
    .optional()
    .default(false)
    .describe('Convert all Excel sheets to separate CSV files'),
})

type Input = z.infer<typeof inputSchema>

type Output = {
  operation: string
  inputFile: string
  outputFiles: string[]
  executionTimeMs?: number
  compression?: string
  rowGroupSize?: number
  cleanData?: boolean
}

// ===== Excel to CSV Functions =====

function sanitizeSheetName(name: string): string {
  return name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
}

function resolveExcelOutputPath(inputPath: string, outputPath?: string): string {
  if (outputPath) return normalizeFilePath(outputPath)
  const parsed = parse(inputPath)
  return join(parsed.dir, `${parsed.name}.csv`)
}

function resolveSheetOutputPath(inputPath: string, sheetName: string): string {
  const parsed = parse(inputPath)
  const safeName = sanitizeSheetName(sheetName) || 'Sheet'
  return join(parsed.dir, `${parsed.name}_${safeName}.csv`)
}

async function writeCsv(outputPath: string, csv: string): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, csv, 'utf8')
}

async function convertExcelToCSV(input: Input): Promise<Output> {
  const startTime = Date.now()
  const inputPath = normalizeFilePath(input.inputPath)
  const workbook = XLSX.readFile(inputPath, { cellDates: true })
  const sheetNames = workbook.SheetNames

  if (sheetNames.length === 0) {
    throw new Error('No sheets found in Excel file')
  }

  if (input.convertAllSheets) {
    const outputs: string[] = []
    const usedNames = new Set<string>()

    for (const sheetName of sheetNames) {
      const sheet = workbook.Sheets[sheetName]
      if (!sheet) continue

      const basePath = resolveSheetOutputPath(inputPath, sheetName)
      let outputPath = basePath
      let counter = 1
      while (usedNames.has(outputPath)) {
        outputPath = basePath.replace(/\.csv$/i, `_${counter}.csv`)
        counter += 1
      }
      usedNames.add(outputPath)

      const csv = XLSX.utils.sheet_to_csv(sheet, { FS: ',', RS: '\n' })
      await writeCsv(outputPath, csv)
      outputs.push(outputPath)
    }

    return {
      operation: 'excel_to_csv',
      inputFile: inputPath,
      outputFiles: outputs,
      executionTimeMs: Date.now() - startTime,
    }
  }

  const targetSheet = input.sheetName || sheetNames[0]
  const sheet = workbook.Sheets[targetSheet]
  if (!sheet) {
    throw new Error(`Sheet "${targetSheet}" not found in Excel file`)
  }

  const outputPath = resolveExcelOutputPath(inputPath, input.outputPath)
  const csv = XLSX.utils.sheet_to_csv(sheet, { FS: ',', RS: '\n' })
  await writeCsv(outputPath, csv)

  return {
    operation: 'excel_to_csv',
    inputFile: inputPath,
    outputFiles: [outputPath],
    executionTimeMs: Date.now() - startTime,
  }
}

// ===== Parquet Conversion Functions =====

type InputFormat = 'csv' | 'json' | 'jsonl'
type QueryResult = Record<string, unknown>[]
type ColumnInfo = { name: string; type: string }

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

function resolveParquetOutputPath(inputPath: string, outputPath?: string): string {
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

async function getColumns(conn: any, viewName: string): Promise<ColumnInfo[]> {
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
  const outputPath = resolveParquetOutputPath(inputPath, input.outputPath)
  const format = inferInputFormat(inputPath)
  const compression = input.compression ?? 'zstd'
  const rowGroupSize = input.rowGroupSize ?? 100000

  if (!format) {
    throw new Error('Only CSV, JSON, or JSONL files are supported for Parquet conversion')
  }

  await mkdir(dirname(outputPath), { recursive: true })

  const duckdb = await tryLoadDuckDb()
  const sourceExpression = buildSourceExpression(inputPath, format)
  const options = buildCopyOptions(compression, rowGroupSize)
  const outputEscaped = escapeSqlString(outputPath)

  if (!duckdb) {
    if (input.cleanData) {
      throw new Error(
        'cleanData requires the DuckDB module. Install "duckdb" or disable cleanData.',
      )
    }
    const copySql = `COPY (SELECT * FROM ${sourceExpression}) TO '${outputEscaped}' (${options})`
    await runDuckDbCli(copySql)
    return {
      operation: 'to_parquet',
      inputFile: inputPath,
      outputFiles: [outputPath],
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
      operation: 'to_parquet',
      inputFile: inputPath,
      outputFiles: [outputPath],
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

// ===== Tool Definition =====

export const FileConverterTool: Tool<typeof inputSchema, Output> = {
  name: 'FileConverter',
  async description() {
    return 'Convert files between formats: Excel→CSV, CSV/JSON→Parquet'
  },
  async prompt() {
    return PROMPT
  },
  inputSchema,
  isReadOnly() {
    return false
  },
  isConcurrencySafe() {
    return false
  },
  userFacingName() {
    return 'FileConverter'
  },
  async isEnabled() {
    return true
  },
  needsPermissions({ inputPath, outputPath, operation, convertAllSheets }) {
    const fullInput = normalizeFilePath(inputPath)
    let fullOutput: string

    if (operation === 'excel_to_csv') {
      fullOutput = convertAllSheets
        ? fullInput
        : resolveExcelOutputPath(fullInput, outputPath)
    } else {
      fullOutput = resolveParquetOutputPath(fullInput, outputPath)
    }

    return !hasReadPermission(fullInput) || !hasWritePermission(fullOutput)
  },
  async validateInput(
    { operation, inputPath, outputPath, rowGroupSize }: Input,
    _context?: ToolUseContext,
  ): Promise<ValidationResult> {
    const fullInput = normalizeFilePath(inputPath)

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

    if (operation === 'excel_to_csv') {
      const inputExt = extname(fullInput).toLowerCase()
      if (inputExt !== '.xlsx' && inputExt !== '.xls') {
        return {
          result: false,
          message: 'For excel_to_csv operation, input must be .xlsx or .xls file',
        }
      }
      if (outputPath && extname(outputPath).toLowerCase() !== '.csv') {
        return {
          result: false,
          message: 'For excel_to_csv operation, output must end with .csv',
        }
      }
    } else if (operation === 'to_parquet') {
      const inputExt = extname(fullInput).toLowerCase()
      if (inputExt === '.parquet') {
        return {
          result: false,
          message: 'Input file is already Parquet. Use AnalyzeLocalFile to query it.',
        }
      }
      if (!inferInputFormat(fullInput)) {
        return {
          result: false,
          message: 'For to_parquet operation, input must be CSV, JSON, or JSONL file',
        }
      }
      const fullOutput = resolveParquetOutputPath(fullInput, outputPath)
      if (fullInput === fullOutput) {
        return {
          result: false,
          message: 'Output path must be different from input path',
        }
      }
      if (extname(fullOutput).toLowerCase() !== '.parquet') {
        return {
          result: false,
          message: 'For to_parquet operation, output must end with .parquet',
        }
      }
      if (rowGroupSize !== undefined && rowGroupSize <= 0) {
        return {
          result: false,
          message: 'Row group size must be a positive number',
        }
      }
    }

    return { result: true }
  },
  renderToolUseMessage(input: Input, { verbose }) {
    const fullInput = normalizeFilePath(input.inputPath)
    const displayInput = verbose ? fullInput : relative(getCwd(), fullInput)

    if (input.operation === 'excel_to_csv') {
      const output = input.convertAllSheets
        ? 'multiple CSV files'
        : resolveExcelOutputPath(fullInput, input.outputPath)
      const displayOutput =
        output === 'multiple CSV files'
          ? output
          : verbose
            ? output
            : relative(getCwd(), output)
      return `FileConverter (Excel→CSV): ${displayInput} → ${displayOutput}`
    } else {
      const fullOutput = resolveParquetOutputPath(fullInput, input.outputPath)
      const displayOutput = verbose ? fullOutput : relative(getCwd(), fullOutput)
      return `FileConverter (→Parquet): ${displayInput} → ${displayOutput} (${input.compression || 'zstd'})`
    }
  },
  renderResultForAssistant(output: Output): string {
    if (output.outputFiles.length === 0) {
      return `Conversion failed for ${output.inputFile}.`
    }

    if (output.operation === 'excel_to_csv') {
      if (output.outputFiles.length === 1) {
        return `Converted ${output.inputFile} to ${output.outputFiles[0]} in ${output.executionTimeMs}ms.`
      }
      return `Converted ${output.inputFile} to ${output.outputFiles.length} CSV files in ${output.executionTimeMs}ms:\n${output.outputFiles.map(p => `- ${p}`).join('\n')}`
    } else {
      return `Converted ${output.inputFile} to ${output.outputFiles[0]} (${output.compression}) in ${output.executionTimeMs}ms.`
    }
  },
  async *call(input: Input, { abortController }) {
    try {
      if (abortController.signal.aborted) {
        yield {
          type: 'result' as const,
          data: {
            operation: input.operation,
            inputFile: input.inputPath,
            outputFiles: [],
          },
          resultForAssistant: 'Conversion cancelled',
        }
        return
      }

      let result: Output
      if (input.operation === 'excel_to_csv') {
        result = await convertExcelToCSV(input)
      } else {
        result = await convertToParquet(input)
      }

      yield {
        type: 'result' as const,
        data: result,
        resultForAssistant: this.renderResultForAssistant(result),
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      const errorResult: Output = {
        operation: input.operation,
        inputFile: input.inputPath,
        outputFiles: [],
      }

      yield {
        type: 'result' as const,
        data: errorResult,
        resultForAssistant: `Conversion failed: ${errorMessage}`,
      }
    }
  },
}
