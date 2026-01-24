/**
 * Utility functions for custom command processing
 */

import { existsSync, readFileSync } from 'fs'
import { basename, dirname, join, relative, sep } from 'path'
import { getCwd } from '@utils/state'
import { debug as debugLogger } from '@utils/log/debugLogger'
import { logError } from '@utils/log'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { parseCommandSafely } from '@utils/shell/commandParser'
import type { CommandSource } from './types'

const execFileAsync = promisify(execFile)

/**
 * Executes bash commands embedded in content using the !`command` syntax.
 * Commands are validated for safety before execution.
 * @param content - Content containing embedded bash commands
 * @returns Content with command outputs substituted
 */
export async function executeBashCommands(content: string): Promise<string> {
  const bashCommandRegex = /!\`([^`]+)\`/g
  const matches = [...content.matchAll(bashCommandRegex)]

  if (matches.length === 0) {
    return content
  }

  let result = content

  for (const match of matches) {
    const fullMatch = match[0]
    const commandStr = match[1].trim()

    try {
      const parseResult = parseCommandSafely(commandStr)

      if (!parseResult.valid) {
        debugLogger.warn('CUSTOM_COMMAND_BLOCKED', {
          command: commandStr,
          reason: parseResult.error,
        })
        result = result.replace(fullMatch, `(blocked: ${parseResult.error})`)
        continue
      }

      const { command: cmd, args } = parseResult

      const { stdout, stderr } = await execFileAsync(cmd!, args!, {
        timeout: 5000,
        encoding: 'utf8',
        cwd: getCwd(),
      })

      const output = stdout.trim() || stderr.trim() || '(no output)'
      result = result.replace(fullMatch, output)
    } catch (error) {
      logError(error)
      debugLogger.warn('CUSTOM_COMMAND_BASH_EXEC_FAILED', {
        command: commandStr,
        error: error instanceof Error ? error.message : String(error),
      })
      result = result.replace(fullMatch, `(error executing: ${commandStr})`)
    }
  }

  return result
}

/**
 * Resolves file references in content using @filepath syntax
 * @param content - Content containing file references
 * @returns Content with file contents substituted
 */
export async function resolveFileReferences(content: string): Promise<string> {
  const fileRefRegex = /@([a-zA-Z0-9/._-]+(?:\.[a-zA-Z0-9]+)?)/g
  const matches = [...content.matchAll(fileRefRegex)]

  if (matches.length === 0) {
    return content
  }

  let result = content

  for (const match of matches) {
    const fullMatch = match[0]
    const filePath = match[1]

    if (filePath.startsWith('agent-')) {
      continue
    }

    try {
      const fullPath = join(getCwd(), filePath)

      if (existsSync(fullPath)) {
        const fileContent = readFileSync(fullPath, { encoding: 'utf-8' })

        const formattedContent = `\n\n## File: ${filePath}\n\`\`\`\n${fileContent}\n\`\`\`\n`
        result = result.replace(fullMatch, formattedContent)
      } else {
        result = result.replace(fullMatch, `(file not found: ${filePath})`)
      }
    } catch (error) {
      logError(error)
      debugLogger.warn('CUSTOM_COMMAND_FILE_READ_FAILED', {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      })
      result = result.replace(fullMatch, `(error reading: ${filePath})`)
    }
  }

  return result
}

/**
 * Checks if a file is a skill markdown file
 * @param filePath - Path to check
 * @returns True if file is skill.md
 */
export function isSkillMarkdownFile(filePath: string): boolean {
  return /^skill\.md$/i.test(basename(filePath))
}

/**
 * Converts command source to display label
 * @param source - Command source
 * @returns Display label
 */
export function sourceLabel(source: CommandSource): string {
  if (source === 'localSettings') return 'project'
  if (source === 'userSettings') return 'user'
  if (source === 'pluginDir') return 'plugin'
  return 'unknown'
}

/**
 * Generates namespace from directory path
 * @param dirPath - Directory path
 * @param baseDir - Base directory
 * @returns Namespace string
 */
export function namespaceFromDirPath(dirPath: string, baseDir: string): string {
  const relPath = relative(baseDir, dirPath)
  if (!relPath || relPath === '.' || relPath.startsWith('..')) return ''
  return relPath.split(sep).join(':')
}

/**
 * Generates command name from file path
 * @param filePath - File path
 * @param baseDir - Base directory
 * @returns Command name
 */
export function nameForCommandFile(filePath: string, baseDir: string): string {
  if (isSkillMarkdownFile(filePath)) {
    const skillDir = dirname(filePath)
    const parentDir = dirname(skillDir)
    const skillName = basename(skillDir)
    const namespace = namespaceFromDirPath(parentDir, baseDir)
    return namespace ? `${namespace}:${skillName}` : skillName
  }

  const dir = dirname(filePath)
  const namespace = namespaceFromDirPath(dir, baseDir)
  const fileName = basename(filePath).replace(/\.md$/i, '')
  return namespace ? `${namespace}:${fileName}` : fileName
}

/**
 * Builds qualified name for plugin command
 * @param pluginName - Plugin name
 * @param localName - Local command name
 * @returns Qualified name
 */
export function buildPluginQualifiedName(
  pluginName: string,
  localName: string,
): string {
  const p = pluginName.trim()
  const l = localName.trim()
  if (!p) return l
  if (!l || l === p) return p
  return `${p}:${l}`
}

/**
 * Generates name for plugin command file
 * @param filePath - File path
 * @param commandsDir - Commands directory
 * @param pluginName - Plugin name
 * @returns Command name
 */
export function nameForPluginCommandFile(
  filePath: string,
  commandsDir: string,
  pluginName: string,
): string {
  const rel = relative(commandsDir, filePath)
  const noExt = rel.replace(/\.md$/i, '')
  const localName = noExt.split(sep).filter(Boolean).join(':')
  return buildPluginQualifiedName(pluginName, localName)
}
