import {
  DocumentBlockParam,
  ImageBlockParam,
} from '@anthropic-ai/sdk/resources/index.mjs'
import { statSync } from 'fs'
import * as path from 'node:path'
import { extname, relative } from 'node:path'
import { z } from 'zod'
import * as XLSX from 'xlsx'
import type { Tool } from '@tool'
import { getCwd } from '@utils/state'
import {
  addLineNumbers,
  findSimilarFile,
  normalizeFilePath,
  readTextContent,
} from '@utils/fs/file'
import { logError } from '@utils/log'
import { emitReminderEvent } from '@services/systemReminder'
import {
  recordFileRead,
  generateFileModificationReminder,
} from '@services/fileFreshness'
import { DESCRIPTION, PROMPT } from './prompt'
import { hasReadPermission } from '@utils/permissions/filesystem'
import { secureFileService } from '@utils/fs/secureFile'
import { readFileBun, fileExistsBun, getFileSizeBun } from '@utils/bun/file'

const MAX_LINES_TO_RENDER = 5
const MAX_LINE_LENGTH = 2000
const MAX_OUTPUT_SIZE = 0.25 * 1024 * 1024

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])

const MAX_WIDTH = 2000
const MAX_HEIGHT = 2000
const MAX_IMAGE_SIZE = 3.75 * 1024 * 1024

const BINARY_EXTENSIONS = new Set([
  '.mp3',
  '.wav',
  '.flac',
  '.ogg',
  '.aac',
  '.m4a',
  '.wma',
  '.aiff',
  '.opus',
  '.mp4',
  '.avi',
  '.mov',
  '.wmv',
  '.flv',
  '.mkv',
  '.webm',
  '.m4v',
  '.mpeg',
  '.mpg',
  '.zip',
  '.rar',
  '.tar',
  '.gz',
  '.bz2',
  '.7z',
  '.xz',
  '.z',
  '.tgz',
  '.iso',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.app',
  '.msi',
  '.deb',
  '.rpm',
  '.bin',
  '.dat',
  '.db',
  '.sqlite',
  '.sqlite3',
  '.mdb',
  '.idx',
  '.doc',
  '.docx',
  '.ppt',
  '.pptx',
  '.odt',
  '.ods',
  '.odp',
  '.ttf',
  '.otf',
  '.woff',
  '.woff2',
  '.eot',
  '.psd',
  '.ai',
  '.eps',
  '.sketch',
  '.fig',
  '.xd',
  '.blend',
  '.obj',
  '.3ds',
  '.max',
  '.class',
  '.jar',
  '.war',
  '.pyc',
  '.pyo',
  '.rlib',
  '.swf',
  '.fla',
])

const inputSchema = z.strictObject({
  file_path: z.string().describe('The absolute path to the file to read'),
  offset: z
    .number()
    .optional()
    .describe(
      'The line number to start reading from. Only provide if the file is too large to read at once',
    ),
  limit: z
    .number()
    .optional()
    .describe(
      'The number of lines to read. Only provide if the file is too large to read at once.',
    ),
})

export const FileReadTool = {
  name: 'Read',
  async description() {
    return DESCRIPTION
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
    return 'Read'
  },
  async isEnabled() {
    return true
  },
  needsPermissions({ file_path }) {
    return !hasReadPermission(file_path || getCwd())
  },
  renderToolUseMessage(input, { verbose }) {
    const { file_path, ...rest } = input
    const entries = [
      ['file_path', verbose ? file_path : relative(getCwd(), file_path)],
      ...Object.entries(rest),
    ]
    return entries
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
      .join(', ')
  },
  async validateInput({ file_path, offset, limit }) {
    const fullFilePath = normalizeFilePath(file_path)

    const fileCheck = secureFileService.safeGetFileInfo(fullFilePath)
    if (!fileCheck.success) {
      const similarFilename = findSimilarFile(fullFilePath)
      let message = 'File does not exist.'

      if (similarFilename) {
        message += ` Did you mean ${similarFilename}?`
      }

      return {
        result: false,
        message,
      }
    }

    const ext = path.extname(fullFilePath).toLowerCase()
    const fileSize = fileCheck.stats?.size ?? 0

    if (BINARY_EXTENSIONS.has(ext)) {
      return {
        result: false,
        message: `This tool cannot read binary files. The file appears to be a binary ${ext} file. Please use appropriate tools for binary file analysis.`,
      }
    }

    if (fileSize === 0 && IMAGE_EXTENSIONS.has(ext)) {
      return {
        result: false,
        message: 'Empty image files cannot be processed.',
      }
    }

    const isNotebook = ext === '.ipynb'
    const isPdf = ext === '.pdf'
    const isImage = IMAGE_EXTENSIONS.has(ext)
    if (!isImage && !isNotebook && !isPdf) {
      if (fileSize > MAX_OUTPUT_SIZE && !offset && !limit) {
        return {
          result: false,
          message: formatFileSizeError(fileSize),
        }
      }
    }

    return { result: true }
  },
  async *call(
    { file_path, offset = 1, limit = undefined },
    { readFileTimestamps },
  ) {
    const ext = path.extname(file_path).toLowerCase()
    const fullFilePath = normalizeFilePath(file_path)

    recordFileRead(fullFilePath)

    emitReminderEvent('file:read', {
      filePath: fullFilePath,
      extension: ext,
      timestamp: Date.now(),
    })

    readFileTimestamps[fullFilePath] = statSync(fullFilePath).mtimeMs

    const modificationReminder = generateFileModificationReminder(fullFilePath)
    if (modificationReminder) {
      emitReminderEvent('file:modified', {
        filePath: fullFilePath,
        reminder: modificationReminder,
        timestamp: Date.now(),
      })
    }

    if (IMAGE_EXTENSIONS.has(ext)) {
      const data = await readImage(fullFilePath, ext)
      yield {
        type: 'result',
        data,
        resultForAssistant: this.renderResultForAssistant(data),
      }
      return
    }

    if (ext === '.ipynb') {
      const notebookRaw = await readFileBun(fullFilePath)
      const notebook = notebookRaw ? JSON.parse(notebookRaw) : null
      const data = {
        type: 'notebook' as const,
        file: {
          filePath: file_path,
          cells: Array.isArray(notebook?.cells) ? notebook.cells : [],
        },
      }
      yield {
        type: 'result',
        data,
        resultForAssistant: this.renderResultForAssistant(data),
      }
      return
    }

    if (ext === '.pdf') {
      const fileReadResult = secureFileService.safeReadFile(fullFilePath, {
        encoding: 'buffer' as BufferEncoding,
        maxFileSize: 10 * 1024 * 1024,
        checkFileExtension: false,
      })
      if (!fileReadResult.success) {
        throw new Error(fileReadResult.error || 'Failed to read PDF file')
      }
      const buffer = fileReadResult.content as Buffer
      const data = {
        type: 'pdf' as const,
        file: {
          filePath: file_path,
          base64: buffer.toString('base64'),
          originalSize: fileReadResult.stats?.size ?? buffer.byteLength,
        },
      }
      yield {
        type: 'result',
        data,
        resultForAssistant: this.renderResultForAssistant(data),
      }
      return
    }

    if (ext === '.xlsx' || ext === '.xls') {
      const excelData = await readExcelFile(fullFilePath, limit)
      const data = {
        type: 'excel' as const,
        file: {
          filePath: file_path,
          sheets: excelData.sheets,
          totalRows: excelData.totalRows,
        },
      }
      yield {
        type: 'result',
        data,
        resultForAssistant: this.renderResultForAssistant(data),
      }
      return
    }

    const startLine = offset
    const zeroBasedOffset = startLine === 0 ? 0 : startLine - 1
    const { content, lineCount, totalLines } = readTextContent(
      fullFilePath,
      zeroBasedOffset,
      limit,
    )

    const truncatedLines = content
      .split(/\r?\n/)
      .map(line =>
        line.length > MAX_LINE_LENGTH ? line.slice(0, MAX_LINE_LENGTH) : line,
      )
      .join('\n')

    if (Buffer.byteLength(truncatedLines, 'utf8') > MAX_OUTPUT_SIZE) {
      throw new Error(
        formatFileSizeError(Buffer.byteLength(truncatedLines, 'utf8')),
      )
    }

    const data = {
      type: 'text' as const,
      file: {
        filePath: file_path,
        content: truncatedLines,
        numLines: lineCount,
        startLine,
        totalLines,
      },
    } as const

    yield {
      type: 'result',
      data,
      resultForAssistant: this.renderResultForAssistant(data),
    }
  },
  renderResultForAssistant(data) {
    switch (data.type) {
      case 'image':
        return [
          {
            type: 'image',
            source: {
              type: 'base64',
              data: data.file.base64,
              media_type: data.file.type,
            },
          },
        ]
      case 'pdf':
        return [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: data.file.base64,
            },
          } satisfies DocumentBlockParam,
        ]
      case 'notebook':
        return JSON.stringify(data.file, null, 2)
      case 'excel':
        let result = `Excel file: ${data.file.filePath}\n`
        result += `Total rows across all sheets: ${data.file.totalRows}\n\n`
        for (const sheet of data.file.sheets) {
          result += `Sheet: ${sheet.name} (${sheet.totalRows} rows)\n`
          result += JSON.stringify(sheet.rows, null, 2) + '\n\n'
        }
        return result
      case 'text':
        return addLineNumbers({
          content: data.file.content,
          startLine: data.file.startLine,
        })
    }
  },
} satisfies Tool<
  typeof inputSchema,
  | {
      type: 'text'
      file: {
        filePath: string
        content: string
        numLines: number
        startLine: number
        totalLines: number
      }
    }
  | {
      type: 'image'
      file: {
        base64: string
        type: ImageBlockParam.Source['media_type']
        originalSize: number
      }
    }
  | { type: 'notebook'; file: { filePath: string; cells: any[] } }
  | {
      type: 'pdf'
      file: { filePath: string; base64: string; originalSize: number }
    }
  | {
      type: 'excel'
      file: {
        filePath: string
        sheets: Array<{
          name: string
          rows: any[]
          totalRows: number
        }>
        totalRows: number
      }
    }
>

const formatFileSizeError = (sizeInBytes: number) =>
  `File content (${Math.round(sizeInBytes / 1024)}KB) exceeds maximum allowed size (${Math.round(MAX_OUTPUT_SIZE / 1024)}KB). Please use offset and limit parameters to read specific portions of the file, or use the Grep tool to search for specific content.`

function createImageResponse(
  buffer: Buffer,
  ext: string,
  originalSize: number,
): {
  type: 'image'
  file: {
    base64: string
    type: ImageBlockParam.Source['media_type']
    originalSize: number
  }
} {
  const normalized: ImageBlockParam.Source['media_type'] =
    ext === '.jpg' || ext === '.jpeg'
      ? 'image/jpeg'
      : ext === '.png'
        ? 'image/png'
        : ext === '.gif'
          ? 'image/gif'
          : 'image/webp'
  return {
    type: 'image',
    file: {
      base64: buffer.toString('base64'),
      type: normalized,
      originalSize,
    },
  }
}

async function readImage(
  filePath: string,
  ext: string,
): Promise<{
  type: 'image'
  file: {
    base64: string
    type: ImageBlockParam.Source['media_type']
    originalSize: number
  }
}> {
  try {
    const stats = statSync(filePath)
    const sharpModule = (await import('sharp')) as any
    const sharp = sharpModule.default || sharpModule

    const fileReadResult = secureFileService.safeReadFile(filePath, {
      encoding: 'buffer' as BufferEncoding,
      maxFileSize: MAX_IMAGE_SIZE,
    })

    if (!fileReadResult.success) {
      throw new Error(`Failed to read image file: ${fileReadResult.error}`)
    }

    const image = sharp(fileReadResult.content as Buffer)
    const metadata = await image.metadata()

    if (!metadata.width || !metadata.height) {
      if (stats.size > MAX_IMAGE_SIZE) {
        const compressedBuffer = await image.jpeg({ quality: 80 }).toBuffer()
        return createImageResponse(compressedBuffer, '.jpeg', stats.size)
      }
    }

    let width = metadata.width || 0
    let height = metadata.height || 0

    if (
      stats.size <= MAX_IMAGE_SIZE &&
      width <= MAX_WIDTH &&
      height <= MAX_HEIGHT
    ) {
      const fileReadResult = secureFileService.safeReadFile(filePath, {
        encoding: 'buffer' as BufferEncoding,
        maxFileSize: MAX_IMAGE_SIZE,
      })

      if (!fileReadResult.success) {
        throw new Error(`Failed to read image file: ${fileReadResult.error}`)
      }

      return createImageResponse(
        fileReadResult.content as Buffer,
        ext,
        stats.size,
      )
    }

    if (width > MAX_WIDTH) {
      height = Math.round((height * MAX_WIDTH) / width)
      width = MAX_WIDTH
    }

    if (height > MAX_HEIGHT) {
      width = Math.round((width * MAX_HEIGHT) / height)
      height = MAX_HEIGHT
    }

    const resizedImageBuffer = await image
      .resize(width, height, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .toBuffer()

    if (resizedImageBuffer.length > MAX_IMAGE_SIZE) {
      const compressedBuffer = await image.jpeg({ quality: 80 }).toBuffer()
      return createImageResponse(compressedBuffer, '.jpeg', stats.size)
    }

    return createImageResponse(resizedImageBuffer, ext, stats.size)
  } catch (e) {
    logError(e)
    const stats = statSync(filePath)
    const fileReadResult = secureFileService.safeReadFile(filePath, {
      encoding: 'buffer' as BufferEncoding,
      maxFileSize: MAX_IMAGE_SIZE,
    })

    if (!fileReadResult.success) {
      throw new Error(`Failed to read image file: ${fileReadResult.error}`)
    }

    return createImageResponse(
      fileReadResult.content as Buffer,
      ext,
      stats.size,
    )
  }
}

async function readExcelFile(
  filePath: string,
  maxRows: number = 100,
): Promise<{
  sheets: Array<{
    name: string
    rows: any[]
    totalRows: number
  }>
  totalRows: number
}> {
  const fileReadResult = secureFileService.safeReadFile(filePath, {
    encoding: 'buffer' as BufferEncoding,
    maxFileSize: 10 * 1024 * 1024,
    checkFileExtension: false,
  })

  if (!fileReadResult.success) {
    throw new Error(fileReadResult.error || 'Failed to read Excel file')
  }

  const buffer = fileReadResult.content as Buffer
  const workbook = XLSX.read(buffer, { type: 'buffer' })

  const sheets = []
  let totalRows = 0

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName]
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 })

    const limitedRows = jsonData.slice(0, maxRows)
    totalRows += jsonData.length

    sheets.push({
      name: sheetName,
      rows: limitedRows,
      totalRows: jsonData.length,
    })
  }

  return { sheets, totalRows }
}
