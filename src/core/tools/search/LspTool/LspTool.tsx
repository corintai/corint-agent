import type { Tool, ToolUseContext } from '@tool'
import { getAbsolutePath } from '@utils/fs/file'
import { hasReadPermission } from '@utils/permissions/filesystem'
import { getCwd } from '@utils/state'
import { existsSync, readFileSync, statSync } from 'fs'
import { extname } from 'path'
import { DESCRIPTION, PROMPT, TOOL_NAME_FOR_PROMPT } from './prompt'
import {
  extractSymbolAtPosition,
  formatDocumentSymbolsResult,
  formatFindReferencesResult,
  formatGoToDefinitionResult,
  formatHoverResult,
  groupLocationsByFile,
  summarizeToolResult,
  toProjectRelativeIfPossible,
} from './formatting'
import { inputSchema, outputSchema, type Input, type Output } from './schema'
import {
  getOrCreateTsProject,
  isFileTypeSupportedByTypescriptBackend,
  tryLoadTypeScriptModule,
} from './typescriptProject'

export const LspTool = {
  name: TOOL_NAME_FOR_PROMPT,
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return PROMPT
  },
  inputSchema,
  userFacingName() {
    return 'LSP'
  },
  async isEnabled() {
    return tryLoadTypeScriptModule(getCwd()) !== null
  },
  isReadOnly() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  needsPermissions({ filePath }: Input) {
    const abs = getAbsolutePath(filePath) ?? filePath
    return !hasReadPermission(abs || getCwd())
  },
  async validateInput(input: Input) {
    const parsed = inputSchema.safeParse(input)
    if (!parsed.success) {
      return {
        result: false,
        message: `Invalid input: ${parsed.error.message}`,
        errorCode: 3,
      }
    }

    const absPath = getAbsolutePath(input.filePath) ?? input.filePath
    if (!existsSync(absPath)) {
      return {
        result: false,
        message: `File does not exist: ${input.filePath}`,
        errorCode: 1,
      }
    }
    try {
      if (!statSync(absPath).isFile()) {
        return {
          result: false,
          message: `Path is not a file: ${input.filePath}`,
          errorCode: 2,
        }
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      return {
        result: false,
        message: `Cannot access file: ${input.filePath}. ${e.message}`,
        errorCode: 4,
      }
    }

    return { result: true }
  },
  renderToolUseMessage(input: Input, { verbose }: { verbose: boolean }) {
    const abs = getAbsolutePath(input.filePath) ?? input.filePath
    const filePathForDisplay = verbose ? abs : toProjectRelativeIfPossible(abs)
    const parts: string[] = []

    if (
      (input.operation === 'goToDefinition' ||
        input.operation === 'findReferences' ||
        input.operation === 'hover' ||
        input.operation === 'goToImplementation') &&
      input.filePath &&
      input.line !== undefined &&
      input.character !== undefined
    ) {
      try {
        const content = readFileSync(abs, 'utf8')
        const symbol = extractSymbolAtPosition(
          content.split('\n'),
          input.line - 1,
          input.character - 1,
        )
        if (symbol) {
          parts.push(`operation: "${input.operation}"`)
          parts.push(`symbol: "${symbol}"`)
          parts.push(`in: "${filePathForDisplay}"`)
          return parts.join(', ')
        }
      } catch {}

      parts.push(`operation: "${input.operation}"`)
      parts.push(`file: "${filePathForDisplay}"`)
      parts.push(`position: ${input.line}:${input.character}`)
      return parts.join(', ')
    }

    parts.push(`operation: "${input.operation}"`)
    if (input.filePath) parts.push(`file: "${filePathForDisplay}"`)
    return parts.join(', ')
  },
  renderResultForAssistant(output: Output) {
    return output.result
  },
  async *call(input: Input, _context: ToolUseContext) {
    const absPath = getAbsolutePath(input.filePath) ?? input.filePath

    if (!isFileTypeSupportedByTypescriptBackend(absPath)) {
      const ext = extname(absPath)
      const out: Output = {
        operation: input.operation,
        result: `No LSP server available for file type: ${ext}`,
        filePath: input.filePath,
        resultCount: 0,
        fileCount: 0,
      }
      yield { type: 'result', data: out, resultForAssistant: out.result }
      return
    }

    const project = getOrCreateTsProject(getCwd())
    if (!project) {
      const out: Output = {
        operation: input.operation,
        result:
          'LSP server manager not initialized. This may indicate a startup issue.',
        filePath: input.filePath,
        resultCount: 0,
        fileCount: 0,
      }
      yield { type: 'result', data: out, resultForAssistant: out.result }
      return
    }

    project.rootFiles.add(absPath)

    const ts = project.ts
    const service = project.languageService
    const program = service.getProgram?.()
    if (!program) {
      const out: Output = {
        operation: input.operation,
        result: `Error performing ${input.operation}: TypeScript program not available`,
        filePath: input.filePath,
        resultCount: 0,
        fileCount: 0,
      }
      yield { type: 'result', data: out, resultForAssistant: out.result }
      return
    }

    const sourceFile = program.getSourceFile(absPath)
    if (!sourceFile) {
      const out: Output = {
        operation: input.operation,
        result: `Error performing ${input.operation}: File is not part of the TypeScript program`,
        filePath: input.filePath,
        resultCount: 0,
        fileCount: 0,
      }
      yield { type: 'result', data: out, resultForAssistant: out.result }
      return
    }

    const pos = ts.getPositionOfLineAndCharacter(
      sourceFile,
      input.line - 1,
      input.character - 1,
    )

    try {
      let formatted: string
      let resultCount = 0
      let fileCount = 0

      switch (input.operation) {
        case 'goToDefinition': {
          const defs = service.getDefinitionAtPosition?.(absPath, pos) ?? []
          const locations = defs
            .map((d: any) => {
              const defSourceFile = program.getSourceFile(d.fileName)
              if (!defSourceFile) return null
              const lc = ts.getLineAndCharacterOfPosition(
                defSourceFile,
                d.textSpan.start,
              )
              return {
                fileName: d.fileName,
                line0: lc.line,
                character0: lc.character,
              }
            })
            .filter(Boolean) as Array<{
            fileName: string
            line0: number
            character0: number
          }>
          const res = formatGoToDefinitionResult(locations)
          formatted = res.formatted
          resultCount = res.resultCount
          fileCount = res.fileCount
          break
        }
        case 'goToImplementation': {
          const impls =
            service.getImplementationAtPosition?.(absPath, pos) ?? []
          const locations = impls
            .map((d: any) => {
              const defSourceFile = program.getSourceFile(d.fileName)
              if (!defSourceFile) return null
              const lc = ts.getLineAndCharacterOfPosition(
                defSourceFile,
                d.textSpan.start,
              )
              return {
                fileName: d.fileName,
                line0: lc.line,
                character0: lc.character,
              }
            })
            .filter(Boolean) as Array<{
            fileName: string
            line0: number
            character0: number
          }>
          const res = formatGoToDefinitionResult(locations)
          formatted = res.formatted
          resultCount = res.resultCount
          fileCount = res.fileCount
          break
        }
        case 'findReferences': {
          const referencedSymbols = service.findReferences?.(absPath, pos) ?? []
          const refs: Array<{
            fileName: string
            line0: number
            character0: number
          }> = []
          for (const sym of referencedSymbols) {
            for (const ref of sym.references ?? []) {
              const refSource = program.getSourceFile(ref.fileName)
              if (!refSource) continue
              const lc = ts.getLineAndCharacterOfPosition(
                refSource,
                ref.textSpan.start,
              )
              refs.push({
                fileName: ref.fileName,
                line0: lc.line,
                character0: lc.character,
              })
            }
          }
          const res = formatFindReferencesResult(refs)
          formatted = res.formatted
          resultCount = res.resultCount
          fileCount = res.fileCount
          break
        }
        case 'hover': {
          const info = service.getQuickInfoAtPosition?.(absPath, pos)
          let text: string | null = null
          let hoverLine0 = input.line - 1
          let hoverCharacter0 = input.character - 1
          if (info) {
            const parts: string[] = []
            const signature = ts.displayPartsToString(info.displayParts ?? [])
            if (signature) parts.push(signature)
            const doc = ts.displayPartsToString(info.documentation ?? [])
            if (doc) parts.push(doc)
            if (info.tags && info.tags.length > 0) {
              for (const tag of info.tags) {
                const tagText = ts.displayPartsToString(tag.text ?? [])
                parts.push(`@${tag.name}${tagText ? ` ${tagText}` : ''}`)
              }
            }
            text = parts.filter(Boolean).join('\n\n')
            const lc = ts.getLineAndCharacterOfPosition(
              sourceFile,
              info.textSpan.start,
            )
            hoverLine0 = lc.line
            hoverCharacter0 = lc.character
          }
          const res = formatHoverResult(text, hoverLine0, hoverCharacter0)
          formatted = res.formatted
          resultCount = res.resultCount
          fileCount = res.fileCount
          break
        }
        case 'documentSymbol': {
          const tree = service.getNavigationTree?.(absPath)
          const lines: string[] = []
          let count = 0

          const kindLabel = (kind: string) => {
            const m = {
              class: 'Class',
              interface: 'Interface',
              enum: 'Enum',
              function: 'Function',
              method: 'Method',
              property: 'Property',
              var: 'Variable',
              let: 'Variable',
              const: 'Constant',
              module: 'Module',
              alias: 'Alias',
              type: 'Type',
            } as Record<string, string>
            return (
              m[kind] ??
              (kind ? kind[0].toUpperCase() + kind.slice(1) : 'Unknown')
            )
          }

          const walk = (node: any, depth: number) => {
            const children: any[] = node?.childItems ?? []
            for (const child of children) {
              const span = child.spans?.[0]
              if (!span) continue
              const lc = ts.getLineAndCharacterOfPosition(
                sourceFile,
                span.start,
              )
              const indent = '  '.repeat(depth)
              const label = kindLabel(child.kind)
              const detail = child.kindModifiers
                ? ` ${child.kindModifiers}`
                : ''
              lines.push(
                `${indent}${child.text} (${label})${detail} - Line ${lc.line + 1}`,
              )
              count += 1
              if (child.childItems && child.childItems.length > 0) {
                walk(child, depth + 1)
              }
            }
          }
          walk(tree, 0)

          const res = formatDocumentSymbolsResult(lines, count)
          formatted = res.formatted
          resultCount = res.resultCount
          fileCount = res.fileCount
          break
        }
        case 'workspaceSymbol': {
          const items =
            service.getNavigateToItems?.('', 100, undefined, true, true) ?? []
          if (!items || items.length === 0) {
            formatted =
              'No symbols found in workspace. This may occur if the workspace is empty, or if the LSP server has not finished indexing the project.'
            resultCount = 0
            fileCount = 0
            break
          }

          const lines: string[] = [
            `Found ${items.length} symbol${items.length === 1 ? '' : 's'} in workspace:`,
          ]
          const grouped = groupLocationsByFile(
            items.map((it: any) => ({
              fileName: it.fileName,
              item: it,
            })),
          )
          for (const [file, itemsInFile] of grouped) {
            lines.push(`\n${file}:`)
            for (const wrapper of itemsInFile) {
              const it: any = (wrapper as any).item
              const sf = program.getSourceFile(it.fileName)
              if (!sf) continue
              const span = it.textSpan
              const lc = span
                ? ts.getLineAndCharacterOfPosition(sf, span.start)
                : { line: 0, character: 0 }
              const label = it.kind
                ? String(it.kind)[0].toUpperCase() + String(it.kind).slice(1)
                : 'Symbol'
              let line = `  ${it.name} (${label}) - Line ${lc.line + 1}`
              if (it.containerName) line += ` in ${it.containerName}`
              lines.push(line)
            }
          }
          formatted = lines.join('\n')
          resultCount = items.length
          fileCount = grouped.size
          break
        }
        case 'prepareCallHierarchy':
        case 'incomingCalls':
        case 'outgoingCalls': {
          const opLabel = input.operation
          formatted = `Error performing ${opLabel}: Call hierarchy is not supported by the TypeScript backend`
          resultCount = 0
          fileCount = 0
          break
        }
        default: {
          formatted = `Error performing ${input.operation}: Unsupported operation`
          resultCount = 0
          fileCount = 0
        }
      }

      const out: Output = {
        operation: input.operation,
        result: formatted,
        filePath: input.filePath,
        resultCount,
        fileCount,
      }
      yield { type: 'result', data: out, resultForAssistant: out.result }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const out: Output = {
        operation: input.operation,
        result: `Error performing ${input.operation}: ${message}`,
        filePath: input.filePath,
      }
      yield { type: 'result', data: out, resultForAssistant: out.result }
    }
  },
} satisfies Tool<typeof inputSchema, Output>
