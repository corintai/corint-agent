import { relative } from 'path'
import { getCwd } from '@utils/state'
import type { Operation } from './schema'

const OPERATION_LABELS: Record<
  Operation,
  { singular: string; plural: string; special?: string }
> = {
  goToDefinition: { singular: 'definition', plural: 'definitions' },
  findReferences: { singular: 'reference', plural: 'references' },
  documentSymbol: { singular: 'symbol', plural: 'symbols' },
  workspaceSymbol: { singular: 'symbol', plural: 'symbols' },
  hover: { singular: 'hover info', plural: 'hover info', special: 'available' },
  goToImplementation: { singular: 'implementation', plural: 'implementations' },
  prepareCallHierarchy: { singular: 'call item', plural: 'call items' },
  incomingCalls: { singular: 'caller', plural: 'callers' },
  outgoingCalls: { singular: 'callee', plural: 'callees' },
}

export function extractSymbolAtPosition(
  lines: string[],
  zeroBasedLine: number,
  zeroBasedCharacter: number,
): string | null {
  try {
    if (zeroBasedLine < 0 || zeroBasedLine >= lines.length) return null
    const line = lines[zeroBasedLine]
    if (zeroBasedCharacter < 0 || zeroBasedCharacter >= line.length) return null
    const tokenRe = /[\w$'!]+|[+\-*/%&|^~<>=]+/g
    let match: RegExpExecArray | null
    while ((match = tokenRe.exec(line)) !== null) {
      const start = match.index
      const end = start + match[0].length
      if (zeroBasedCharacter >= start && zeroBasedCharacter < end) {
        const token = match[0]
        return token.length > 30 ? `${token.slice(0, 27)}...` : token
      }
    }
    return null
  } catch {
    return null
  }
}

export function toProjectRelativeIfPossible(filePath: string): string {
  const cwd = getCwd()
  try {
    const rel = relative(cwd, filePath)
    if (!rel || rel === '') return filePath
    if (rel.startsWith('..')) return filePath
    return rel
  } catch {
    return filePath
  }
}

function formatLocation(
  fileName: string,
  line0: number,
  character0: number,
): string {
  return `${toProjectRelativeIfPossible(fileName)}:${line0 + 1}:${character0 + 1}`
}

export function groupLocationsByFile<T extends { fileName: string }>(
  items: T[],
): Map<string, T[]> {
  const grouped = new Map<string, T[]>()
  for (const item of items) {
    const key = toProjectRelativeIfPossible(item.fileName)
    const existing = grouped.get(key)
    if (existing) existing.push(item)
    else grouped.set(key, [item])
  }
  return grouped
}

export function formatGoToDefinitionResult(
  locations: Array<{
    fileName: string
    line0: number
    character0: number
  }> | null,
): { formatted: string; resultCount: number; fileCount: number } {
  if (!locations || locations.length === 0) {
    return {
      formatted:
        'No definition found. This may occur if the cursor is not on a symbol, or if the definition is in an external library not indexed by the LSP server.',
      resultCount: 0,
      fileCount: 0,
    }
  }
  const fileCount = new Set(locations.map(l => l.fileName)).size
  if (locations.length === 1) {
    const loc = locations[0]
    return {
      formatted: `Defined in ${formatLocation(loc.fileName, loc.line0, loc.character0)}`,
      resultCount: 1,
      fileCount,
    }
  }
  return {
    formatted: `Found ${locations.length} definitions:\n${locations
      .map(
        loc => `  ${formatLocation(loc.fileName, loc.line0, loc.character0)}`,
      )
      .join('\n')}`,
    resultCount: locations.length,
    fileCount,
  }
}

export function formatFindReferencesResult(
  references: Array<{
    fileName: string
    line0: number
    character0: number
  }> | null,
): { formatted: string; resultCount: number; fileCount: number } {
  if (!references || references.length === 0) {
    return {
      formatted:
        'No references found. This may occur if the symbol has no usages, or if the LSP server has not fully indexed the workspace.',
      resultCount: 0,
      fileCount: 0,
    }
  }
  if (references.length === 1) {
    const ref = references[0]
    return {
      formatted: `Found 1 reference:\n  ${formatLocation(ref.fileName, ref.line0, ref.character0)}`,
      resultCount: 1,
      fileCount: 1,
    }
  }

  const grouped = groupLocationsByFile(references)
  const lines: string[] = [
    `Found ${references.length} references across ${grouped.size} files:`,
  ]
  for (const [file, refs] of grouped) {
    lines.push(`\n${file}:`)
    for (const ref of refs) {
      lines.push(`  Line ${ref.line0 + 1}:${ref.character0 + 1}`)
    }
  }
  return {
    formatted: lines.join('\n'),
    resultCount: references.length,
    fileCount: grouped.size,
  }
}

export function formatHoverResult(
  hoverText: string | null,
  line0: number,
  character0: number,
) {
  if (!hoverText || hoverText.trim() === '') {
    return {
      formatted:
        'No hover information available. This may occur if the cursor is not on a symbol, or if the LSP server has not fully indexed the file.',
      resultCount: 0,
      fileCount: 0,
    }
  }
  return {
    formatted: `Hover info at ${line0 + 1}:${character0 + 1}:\n\n${hoverText}`,
    resultCount: 1,
    fileCount: 1,
  }
}

export function formatDocumentSymbolsResult(lines: string[], symbolCount: number) {
  if (symbolCount === 0) {
    return {
      formatted:
        'No symbols found in document. This may occur if the file is empty, not supported by the LSP server, or if the server has not fully indexed the file.',
      resultCount: 0,
      fileCount: 0,
    }
  }
  return {
    formatted: ['Document symbols:', ...lines].join('\n'),
    resultCount: symbolCount,
    fileCount: 1,
  }
}

export function summarizeToolResult(
  operation: Operation,
  resultCount: number,
  fileCount: number,
) {
  const label = OPERATION_LABELS[operation] ?? {
    singular: 'result',
    plural: 'results',
  }
  const noun = resultCount === 1 ? label.singular : label.plural
  if (operation === 'hover' && resultCount > 0 && label.special) {
    return `Hover info ${label.special}`
  }
  const filesPart = fileCount > 1 ? ` across ${fileCount} files` : ''
  return `Found ${resultCount} ${noun}${filesPart}`
}
