import type {
  ImageBlockParam,
  TextBlockParam,
} from '@anthropic-ai/sdk/resources/index.mjs'

import { extname, relative } from 'path'
import { z } from 'zod'
import { Tool } from '@tool'
import {
  NotebookCellSource,
  NotebookContent,
  NotebookCell,
  NotebookOutputImage,
  NotebookCellSourceOutput,
  NotebookCellOutput,
  NotebookCellType,
} from '@kode-types/notebook'
import { formatOutput } from '@tools/BashTool/utils'
import { getCwd } from '@utils/state'
import { findSimilarFile, normalizeFilePath } from '@utils/fs/file'
import { readFileBun, fileExistsBun } from '@utils/bun/file'
import { DESCRIPTION, PROMPT } from './prompt'
import { hasReadPermission } from '@utils/permissions/filesystem'

const inputSchema = z.strictObject({
  notebook_path: z
    .string()
    .describe(
      'The absolute path to the Jupyter notebook file to read (must be absolute, not relative)',
    ),
})

type In = typeof inputSchema
type Out = NotebookCellSource[]

export const NotebookReadTool = {
  name: 'ReadNotebook',
  async description() {
    return DESCRIPTION
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
    return 'Read Notebook'
  },
  async isEnabled() {
    return true
  },
  needsPermissions({ notebook_path }) {
    return !hasReadPermission(normalizeFilePath(notebook_path))
  },
  async validateInput({ notebook_path }) {
    const fullFilePath = normalizeFilePath(notebook_path)

    if (!fileExistsBun(fullFilePath)) {
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

    if (extname(fullFilePath) !== '.ipynb') {
      return {
        result: false,
        message: 'File must be a Jupyter notebook (.ipynb file).',
      }
    }

    return { result: true }
  },
  renderToolUseMessage(input, { verbose }) {
    const fullFilePath = normalizeFilePath(input.notebook_path)
    return `notebook_path: ${verbose ? fullFilePath : relative(getCwd(), fullFilePath)}`
  },
  async *call({ notebook_path }) {
    const fullPath = normalizeFilePath(notebook_path)

    const content = await readFileBun(fullPath)
    if (!content) {
      throw new Error('Could not read notebook file')
    }
    const notebook = JSON.parse(content) as NotebookContent
    const language = notebook.metadata.language_info?.name ?? 'python'
    const cells = notebook.cells.map((cell, index) =>
      processCell(cell, index, language),
    )

    yield {
      type: 'result',
      resultForAssistant: this.renderResultForAssistant(cells),
      data: cells,
    }
  },
  renderResultForAssistant(data: NotebookCellSource[]) {
    return data
      .map((cell, index) => {
        let content = `Cell ${index + 1} (${cell.cellType}):\n${cell.source}`
        if (cell.outputs && cell.outputs.length > 0) {
          const outputText = cell.outputs
            .map(output => output.text)
            .filter(Boolean)
            .join('\n')
          if (outputText) {
            content += `\nOutput:\n${outputText}`
          }
        }
        return content
      })
      .join('\n\n')
  },
} satisfies Tool<In, Out>

function processOutputText(text: string | string[] | undefined): string {
  if (!text) return ''
  const rawText = Array.isArray(text) ? text.join('') : text
  const { truncatedContent } = formatOutput(rawText)
  return truncatedContent
}

function extractImage(
  data: Record<string, unknown>,
): NotebookOutputImage | undefined {
  if (typeof data['image/png'] === 'string') {
    return {
      image_data: data['image/png'] as string,
      media_type: 'image/png',
    }
  }
  if (typeof data['image/jpeg'] === 'string') {
    return {
      image_data: data['image/jpeg'] as string,
      media_type: 'image/jpeg',
    }
  }
  return undefined
}

function processOutput(output: NotebookCellOutput) {
  switch (output.output_type) {
    case 'stream':
      return {
        output_type: output.output_type,
        text: processOutputText(output.text),
      }
    case 'execute_result':
    case 'display_data':
      return {
        output_type: output.output_type,
        text: processOutputText(
          output.data?.['text/plain'] as string | string[] | undefined,
        ),
        image: output.data && extractImage(output.data),
      }
    case 'error':
      return {
        output_type: output.output_type,
        text: processOutputText(
          `${output.ename}: ${output.evalue}\n${output.traceback.join('\n')}`,
        ),
      }
  }
}

function processCell(
  cell: NotebookCell,
  index: number,
  language: string,
): NotebookCellSource {
  const cellData: NotebookCellSource = {
    cell: index,
    cellType: cell.cell_type,
    source: Array.isArray(cell.source) ? cell.source.join('') : cell.source,
    language,
    execution_count: cell.execution_count,
  }

  if (cell.outputs?.length) {
    cellData.outputs = cell.outputs.map(processOutput)
  }

  return cellData
}

function cellContentToToolResult(cell: NotebookCellSource): TextBlockParam {
  const metadata = []
  if (cell.cellType !== 'code') {
    metadata.push(`<cell_type>${cell.cellType}</cell_type>`)
  }
  if (cell.language !== 'python' && cell.cellType === 'code') {
    metadata.push(`<language>${cell.language}</language>`)
  }
  const cellContent = `<cell ${cell.cell}>${metadata.join('')}${cell.source}</cell ${cell.cell}>`
  return {
    text: cellContent,
    type: 'text',
  }
}

function cellOutputToToolResult(output: NotebookCellSourceOutput) {
  const outputs: (TextBlockParam | ImageBlockParam)[] = []
  if (output.text) {
    outputs.push({
      text: `\n${output.text}`,
      type: 'text',
    })
  }
  if (output.image) {
    outputs.push({
      type: 'image',
      source: {
        data: output.image.image_data,
        media_type: output.image.media_type,
        type: 'base64',
      },
    })
  }
  return outputs
}

function getToolResultFromCell(cell: NotebookCellSource) {
  const contentResult = cellContentToToolResult(cell)
  const outputResults = cell.outputs?.flatMap(cellOutputToToolResult)
  return [contentResult, ...(outputResults ?? [])]
}

export function isNotebookCellType(
  value: string | null,
): value is NotebookCellType {
  return value === 'code' || value === 'markdown'
}
