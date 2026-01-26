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
import * as XLSX from 'xlsx'
import { PROMPT } from './prompt'

const inputSchema = z.strictObject({
  inputPath: z.string().describe('Input Excel file path (.xlsx or .xls)'),
  outputPath: z
    .string()
    .optional()
    .describe('Output CSV file path (default: same name with .csv extension)'),
  sheetName: z
    .string()
    .optional()
    .describe('Sheet name to convert (default: first sheet)'),
  convertAllSheets: z
    .boolean()
    .optional()
    .default(false)
    .describe('Convert all sheets to separate CSV files'),
})

type Input = z.infer<typeof inputSchema>

type Output = {
  inputFile: string
  outputFiles: string[]
}

function sanitizeSheetName(name: string): string {
  return name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
}

function resolveOutputPath(inputPath: string, outputPath?: string): string {
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

    return { inputFile: inputPath, outputFiles: outputs }
  }

  const targetSheet = input.sheetName || sheetNames[0]
  const sheet = workbook.Sheets[targetSheet]
  if (!sheet) {
    throw new Error(`Sheet "${targetSheet}" not found in Excel file`)
  }

  const outputPath = resolveOutputPath(inputPath, input.outputPath)
  const csv = XLSX.utils.sheet_to_csv(sheet, { FS: ',', RS: '\n' })
  await writeCsv(outputPath, csv)

  return { inputFile: inputPath, outputFiles: [outputPath] }
}

export const ConvertExcelToCSVTool: Tool<typeof inputSchema, Output> = {
  name: 'ConvertExcelToCSV',
  async description() {
    return 'Convert Excel files to CSV for faster analysis'
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
    return 'ConvertExcelToCSV'
  },
  async isEnabled() {
    return true
  },
  needsPermissions({ inputPath, outputPath, convertAllSheets }) {
    const fullInput = normalizeFilePath(inputPath)
    const resolvedOutput =
      convertAllSheets
        ? fullInput
        : resolveOutputPath(fullInput, outputPath)
    return !hasReadPermission(fullInput) || !hasWritePermission(resolvedOutput)
  },
  async validateInput(
    { inputPath, outputPath }: Input,
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

    const inputExt = extname(fullInput).toLowerCase()
    if (inputExt !== '.xlsx' && inputExt !== '.xls') {
      return {
        result: false,
        message: 'Only .xlsx or .xls files are supported',
      }
    }

    if (outputPath && extname(outputPath).toLowerCase() !== '.csv') {
      return {
        result: false,
        message: 'Output path must end with .csv',
      }
    }

    return { result: true }
  },
  renderToolUseMessage(
    { inputPath, outputPath, convertAllSheets }: Input,
    { verbose },
  ) {
    const fullInput = normalizeFilePath(inputPath)
    const output = convertAllSheets
      ? 'multiple CSV files'
      : resolveOutputPath(fullInput, outputPath)
    const displayInput = verbose ? fullInput : relative(getCwd(), fullInput)
    const displayOutput =
      output === 'multiple CSV files'
        ? output
        : verbose
          ? output
          : relative(getCwd(), output)
    return `ConvertExcelToCSV: ${displayInput} -> ${displayOutput}`
  },
  renderResultForAssistant(output: Output): string {
    if (output.outputFiles.length === 0) {
      return `No CSV files were created from ${output.inputFile}.`
    }
    if (output.outputFiles.length === 1) {
      return `Converted ${output.inputFile} to ${output.outputFiles[0]}.`
    }
    return `Converted ${output.inputFile} to ${output.outputFiles.length} CSV files:\n${output.outputFiles.map(p => `- ${p}`).join('\n')}`
  },
  async *call(input: Input, { abortController }) {
    try {
      if (abortController.signal.aborted) {
        yield {
          type: 'result' as const,
          data: {
            inputFile: input.inputPath,
            outputFiles: [],
          },
          resultForAssistant: 'Conversion cancelled',
        }
        return
      }

      const result = await convertExcelToCSV(input)

      yield {
        type: 'result' as const,
        data: result,
        resultForAssistant: this.renderResultForAssistant(result),
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      const errorResult: Output = {
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
