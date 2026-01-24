/**
 * Bash Command Path Permission Engine
 *
 * This module validates file system paths in bash commands to ensure they comply
 * with security policies. It extracts paths from various shell commands (ls, cat, rm, etc.)
 * and checks them against allowed working directories and permission rules.
 *
 * Key concepts:
 * - PATH_COMMAND_ARG_EXTRACTORS: Maps commands to functions that extract path arguments
 * - COMMAND_PATH_BEHAVIOR: Defines whether a command reads, writes, or creates files
 * - Path validation considers: working directories, deny rules, sensitive paths, wildcards
 */

import { homedir } from 'os'
import path from 'path'

import type { ToolPermissionContext } from '@kode-types/toolPermissionContext'
import { getOriginalCwd } from '@utils/state'
import { PRODUCT_NAME } from '@constants/product'
import {
  getWriteSafetyCheckForPath,
  isPathInWorkingDirectories,
  matchPermissionRuleForPath,
  resolveLikeCliPath,
  suggestFilePermissionUpdates,
} from '../fileToolPermissionEngine'

import {
  parseShellTokens,
  restoreShellStringToken,
  splitBashCommandIntoSubcommands,
} from './parser'
import { stripOutputRedirections, type Redirection } from './redirections'
import type { BashPermissionDecision, DecisionReason } from './types'

/** Regex pattern to detect shell glob/wildcard characters */
const WILDCARD_PATTERN = /[*?[\]{}]/

/** Operation type for path-based commands */
type BashPathOp = 'read' | 'write' | 'create'

/**
 * Command-specific path argument extractors.
 * Each function takes the command's arguments and returns an array of paths
 * that the command will access. Handles command-specific flag parsing.
 */
const PATH_COMMAND_ARG_EXTRACTORS: Record<
  string,
  (args: string[]) => string[]
> = {
  cd: args => (args.length === 0 ? [homedir()] : [args.join(' ')]),
  ls: args => {
    const cleaned = args.filter(a => a && !a.startsWith('-'))
    return cleaned.length > 0 ? cleaned : ['.']
  },
  find: args => {
    const out: string[] = []
    const paramFlags = new Set([
      '-newer',
      '-anewer',
      '-cnewer',
      '-mnewer',
      '-samefile',
      '-path',
      '-wholename',
      '-ilname',
      '-lname',
      '-ipath',
      '-iwholename',
    ])
    const newerRe = /^-newer[acmBt][acmtB]$/
    let sawNonFlag = false
    for (let i = 0; i < args.length; i++) {
      const token = args[i]
      if (!token) continue
      if (token.startsWith('-')) {
        if (['-H', '-L', '-P'].includes(token)) continue
        sawNonFlag = true
        if (paramFlags.has(token) || newerRe.test(token)) {
          const next = args[i + 1]
          if (next) {
            out.push(next)
            i++
          }
        }
        continue
      }
      if (!sawNonFlag) out.push(token)
    }
    return out.length > 0 ? out : ['.']
  },
  mkdir: args => args.filter(a => a && !a.startsWith('-')),
  touch: args => args.filter(a => a && !a.startsWith('-')),
  rm: args => args.filter(a => a && !a.startsWith('-')),
  rmdir: args => args.filter(a => a && !a.startsWith('-')),
  mv: args => args.filter(a => a && !a.startsWith('-')),
  cp: args => args.filter(a => a && !a.startsWith('-')),
  cat: args => args.filter(a => a && !a.startsWith('-')),
  head: args => args.filter(a => a && !a.startsWith('-')),
  tail: args => args.filter(a => a && !a.startsWith('-')),
  sort: args => args.filter(a => a && !a.startsWith('-')),
  uniq: args => args.filter(a => a && !a.startsWith('-')),
  wc: args => args.filter(a => a && !a.startsWith('-')),
  cut: args => args.filter(a => a && !a.startsWith('-')),
  paste: args => args.filter(a => a && !a.startsWith('-')),
  column: args => args.filter(a => a && !a.startsWith('-')),
  file: args => args.filter(a => a && !a.startsWith('-')),
  stat: args => args.filter(a => a && !a.startsWith('-')),
  diff: args => args.filter(a => a && !a.startsWith('-')),
  awk: args => args.filter(a => a && !a.startsWith('-')),
  strings: args => args.filter(a => a && !a.startsWith('-')),
  hexdump: args => args.filter(a => a && !a.startsWith('-')),
  od: args => args.filter(a => a && !a.startsWith('-')),
  base64: args => args.filter(a => a && !a.startsWith('-')),
  nl: args => args.filter(a => a && !a.startsWith('-')),
  sha256sum: args => args.filter(a => a && !a.startsWith('-')),
  sha1sum: args => args.filter(a => a && !a.startsWith('-')),
  md5sum: args => args.filter(a => a && !a.startsWith('-')),
  tr: args => {
    const hasDelete = args.some(
      a =>
        a === '-d' ||
        a === '--delete' ||
        (a.startsWith('-') && a.includes('d')),
    )
    const cleaned = args.filter(a => a && !a.startsWith('-'))
    return cleaned.slice(hasDelete ? 1 : 2)
  },
  grep: args =>
    extractPathArgsLikeClaude(
      args,
      new Set([
        '-e',
        '--regexp',
        '-f',
        '--file',
        '--exclude',
        '--include',
        '--exclude-dir',
        '--include-dir',
        '-m',
        '--max-count',
        '-A',
        '--after-context',
        '-B',
        '--before-context',
        '-C',
        '--context',
      ]),
    ),
  rg: args =>
    extractPathArgsLikeClaude(
      args,
      new Set([
        '-e',
        '--regexp',
        '-f',
        '--file',
        '-t',
        '--type',
        '-T',
        '--type-not',
        '-g',
        '--glob',
        '-m',
        '--max-count',
        '--max-depth',
        '-r',
        '--replace',
        '-A',
        '--after-context',
        '-B',
        '--before-context',
        '-C',
        '--context',
      ]),
      ['.'],
    ),
  sed: args => {
    const out: string[] = []
    let skipNext = false
    let sawExpression = false
    for (let i = 0; i < args.length; i++) {
      if (skipNext) {
        skipNext = false
        continue
      }
      const token = args[i]
      if (!token) continue
      if (token.startsWith('-')) {
        if (token === '-f' || token === '--file') {
          const next = args[i + 1]
          if (next) {
            out.push(next)
            skipNext = true
            sawExpression = true
          }
        } else if (token === '-e' || token === '--expression') {
          skipNext = true
          sawExpression = true
        } else if (token.includes('e') || token.includes('f')) {
          sawExpression = true
        }
        continue
      }
      if (!sawExpression) {
        sawExpression = true
        continue
      }
      out.push(token)
    }
    return out
  },
  jq: args => {
    const out: string[] = []
    const flags = new Set([
      '-e',
      '--expression',
      '-f',
      '--from-file',
      '--arg',
      '--argjson',
      '--slurpfile',
      '--rawfile',
      '--args',
      '--jsonargs',
      '-L',
      '--library-path',
      '--indent',
      '--tab',
    ])
    let sawExpression = false
    for (let i = 0; i < args.length; i++) {
      const token = args[i]
      if (token === undefined || token === null) continue
      if (token.startsWith('-')) {
        const flag = token.split('=')[0]
        if (flag && (flag === '-e' || flag === '--expression'))
          sawExpression = true
        if (flag && flags.has(flag) && !token.includes('=')) i++
        continue
      }
      if (!sawExpression) {
        sawExpression = true
        continue
      }
      out.push(token)
    }
    return out
  },
  git: args => {
    if (args.length >= 1 && args[0] === 'diff') {
      if (args.includes('--no-index')) {
        return args
          .slice(1)
          .filter(a => a && !a.startsWith('-'))
          .slice(0, 2)
      }
    }
    return []
  },
}

/** Set of commands that have path-based permission checks */
const PATH_COMMANDS = new Set(Object.keys(PATH_COMMAND_ARG_EXTRACTORS))

/**
 * Maps commands to their file system operation type.
 * - 'read': Command only reads files (safe for read-only directories)
 * - 'write': Command modifies or deletes files (requires write permission)
 * - 'create': Command creates new files/directories
 */
const COMMAND_PATH_BEHAVIOR: Record<string, BashPathOp> = {
  cd: 'read',
  ls: 'read',
  find: 'read',
  mkdir: 'create',
  touch: 'create',
  rm: 'write',
  rmdir: 'write',
  mv: 'write',
  cp: 'write',
  cat: 'read',
  head: 'read',
  tail: 'read',
  sort: 'read',
  uniq: 'read',
  wc: 'read',
  cut: 'read',
  paste: 'read',
  column: 'read',
  tr: 'read',
  file: 'read',
  stat: 'read',
  diff: 'read',
  awk: 'read',
  strings: 'read',
  hexdump: 'read',
  od: 'read',
  base64: 'read',
  nl: 'read',
  grep: 'read',
  rg: 'read',
  sed: 'write',
  git: 'read',
  jq: 'read',
  sha256sum: 'read',
  sha1sum: 'read',
  md5sum: 'read',
}

const COMMAND_DESCRIPTIONS: Record<string, string> = {
  cd: 'change directories to',
  ls: 'list files in',
  find: 'search files in',
  mkdir: 'create directories in',
  touch: 'create or modify files in',
  rm: 'remove files from',
  rmdir: 'remove directories from',
  mv: 'move files to/from',
  cp: 'copy files to/from',
  cat: 'concatenate files from',
  head: 'read the beginning of files from',
  tail: 'read the end of files from',
  sort: 'sort contents of files from',
  uniq: 'filter duplicate lines from files in',
  wc: 'count lines/words/bytes in files from',
  cut: 'extract columns from files in',
  paste: 'merge files from',
  column: 'format files from',
  tr: 'transform text from files in',
  file: 'examine file types in',
  stat: 'read file stats from',
  diff: 'compare files from',
  awk: 'process text from files in',
  strings: 'extract strings from files in',
  hexdump: 'display hex dump of files from',
  od: 'display octal dump of files from',
  base64: 'encode/decode files from',
  nl: 'number lines in files from',
  grep: 'search for patterns in files from',
  rg: 'search for patterns in files from',
  sed: 'edit files in',
  git: 'access files with git from',
  jq: 'process JSON from files in',
  sha256sum: 'compute SHA-256 checksums for files in',
  sha1sum: 'compute SHA-1 checksums for files in',
  md5sum: 'compute MD5 checksums for files in',
}

function stripQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/g, '')
}

function extractPathArgsLikeClaude(
  args: string[],
  flagsTakingValues: Set<string>,
  defaultIfEmpty: string[] = [],
): string[] {
  const out: string[] = []
  let sawPatternOrExpr = false

  for (let i = 0; i < args.length; i++) {
    const token = args[i]
    if (token === undefined || token === null) continue
    if (token.startsWith('-')) {
      const flag = token.split('=')[0]
      if (
        flag &&
        (flag === '-e' ||
          flag === '--regexp' ||
          flag === '-f' ||
          flag === '--file')
      ) {
        sawPatternOrExpr = true
      }
      if (flag && flagsTakingValues.has(flag) && !token.includes('=')) {
        i++
      }
      continue
    }
    if (!sawPatternOrExpr) {
      sawPatternOrExpr = true
      continue
    }
    out.push(token)
  }

  return out.length > 0 ? out : defaultIfEmpty
}

type PathPermissionCheck = {
  allowed: boolean
  resolvedPath: string
  decisionReason?: DecisionReason
}

function getAllowedWorkingDirectories(
  context: ToolPermissionContext,
): string[] {
  return [
    resolveLikeCliPath(getOriginalCwd()),
    ...Array.from(context.additionalWorkingDirectories.keys()),
  ]
}

function formatAllowedDirs(dirs: string[], max = 5): string {
  const count = dirs.length
  if (count <= max) return dirs.map(d => `'${d}'`).join(', ')
  return `${dirs
    .slice(0, max)
    .map(d => `'${d}'`)
    .join(', ')}, and ${count - max} more`
}

function resolveTildeLikeClaude(value: string): string {
  if (value === '~' || value.startsWith('~/')) {
    return homedir() + value.slice(1)
  }
  return value
}

/**
 * Extracts the base directory from a glob pattern for permission checking.
 * For "src/**\/*.ts", returns "src". For non-glob paths, returns dirname.
 */
function baseDirForGlobPattern(pattern: string): string {
  if (!WILDCARD_PATTERN.test(pattern)) return path.dirname(pattern)
  const idx = pattern.search(WILDCARD_PATTERN)
  const slice = pattern.slice(0, idx)
  return path.dirname(slice)
}

/**
 * Core permission check for a single absolute path.
 * Checks deny rules first, then verifies path is in allowed working directories.
 */
function checkPathPermission(
  absPath: string,
  toolPermissionContext: ToolPermissionContext,
  operation: BashPathOp,
): PathPermissionCheck {
  const denyRule = matchPermissionRuleForPath({
    inputPath: absPath,
    toolPermissionContext,
    operation: operation === 'read' ? 'read' : 'edit',
    behavior: 'deny',
  })
  if (denyRule) {
    return {
      allowed: false,
      resolvedPath: absPath,
      decisionReason: { type: 'rule', rule: denyRule },
    }
  }

  if (
    !isPathInWorkingDirectories(absPath, toolPermissionContext) &&
    operation !== 'read'
  ) {
    return {
      allowed: false,
      resolvedPath: absPath,
      decisionReason: {
        type: 'other',
        reason: `Output path '${absPath}' is not in allowed working directories`,
      },
    }
  }

  return { allowed: true, resolvedPath: absPath }
}

function checkPathArgAllowed(
  rawPath: string,
  cwd: string,
  toolPermissionContext: ToolPermissionContext,
  operation: BashPathOp,
): PathPermissionCheck {
  const unquoted = resolveTildeLikeClaude(stripQuotes(rawPath))
  const expandedPath = unquoted.replaceAll(/~(?=\/|$)/g, homedir())
  const resolvedPath = path.isAbsolute(expandedPath)
    ? expandedPath
    : path.resolve(cwd, expandedPath)

  if (WILDCARD_PATTERN.test(rawPath)) {
    const base = baseDirForGlobPattern(expandedPath)
    const basePath = path.isAbsolute(base) ? base : path.resolve(cwd, base)
    return checkPathPermission(
      resolveLikeCliPath(basePath),
      toolPermissionContext,
      operation,
    )
  }

  return checkPathPermission(
    resolveLikeCliPath(resolvedPath),
    toolPermissionContext,
    operation,
  )
}

function isCriticalRemovalTarget(absPath: string): boolean {
  const target = absPath.replace(/\/+$/, '')
  if (target === '/' || target === '/root' || target === '/home') return true

  const userHome = homedir().replace(/\/+$/, '')
  if (target === userHome) return true

  const protectedDirs = ['/bin', '/sbin', '/usr', '/etc', '/var', '/opt']
  return protectedDirs.includes(target)
}

function validatePathRestrictedCommand(
  baseCommand: string,
  args: string[],
  cwd: string,
  toolPermissionContext: ToolPermissionContext,
  hasCdInCompound: boolean,
): BashPermissionDecision {
  const pathExtractor = PATH_COMMAND_ARG_EXTRACTORS[baseCommand]
  if (!pathExtractor) {
    return {
      behavior: 'passthrough',
      message: `No path restrictions for ${baseCommand}`,
    }
  }

  const possiblePaths = pathExtractor(args)
  if (possiblePaths.length === 0) {
    return {
      behavior: 'passthrough',
      message: `No path arguments for ${baseCommand}`,
    }
  }

  for (const rawPath of possiblePaths) {
    if (!rawPath || rawPath.startsWith('-')) continue

    const permission = checkPathArgAllowed(
      rawPath,
      cwd,
      toolPermissionContext,
      COMMAND_PATH_BEHAVIOR[baseCommand],
    )

    if (!permission.allowed) {
      const allowedDirs = getAllowedWorkingDirectories(toolPermissionContext)
      const formatted = formatAllowedDirs(allowedDirs)
      const message =
        permission.decisionReason?.type === 'other'
          ? permission.decisionReason.reason
          : permission.decisionReason?.type === 'rule'
            ? `The command '${baseCommand} ${rawPath}' is not allowed because it is blocked by a deny rule.`
            : `The command '${baseCommand} ${rawPath}' is not allowed. For security, ${PRODUCT_NAME} may only access files in the allowed working directories for this session: ${formatted}.`

      if (permission.decisionReason?.type === 'rule') {
        return {
          behavior: 'deny',
          message,
          decisionReason: permission.decisionReason,
        }
      }

      return {
        behavior: 'ask',
        message,
        blockedPath: permission.resolvedPath,
        suggestions: suggestFilePermissionUpdates({
          inputPath: permission.resolvedPath,
          operation: COMMAND_PATH_BEHAVIOR[baseCommand],
          toolPermissionContext,
        }),
      }
    }

    const check = getWriteSafetyCheckForPath(permission.resolvedPath)
    if ('message' in check) {
      return {
        behavior: 'ask',
        message: check.message,
        decisionReason: { type: 'other', reason: check.message },
        blockedPath: permission.resolvedPath,
      }
    }

    if (
      COMMAND_PATH_BEHAVIOR[baseCommand] === 'write' &&
      (baseCommand === 'rm' || baseCommand === 'rmdir')
    ) {
      const unquoted = resolveTildeLikeClaude(stripQuotes(rawPath))
      const abs = path.isAbsolute(unquoted)
        ? unquoted
        : path.resolve(cwd, unquoted)
      const resolved = resolveLikeCliPath(abs)
      if (isCriticalRemovalTarget(resolved)) {
        return {
          behavior: 'ask',
          message: `Dangerous ${baseCommand} operation detected: '${resolved}'\n\nThis command would remove a critical system directory. This requires explicit approval and cannot be auto-allowed by permission rules.`,
          decisionReason: {
            type: 'other',
            reason: `Dangerous ${baseCommand} operation on critical path: ${resolved}`,
          },
          suggestions: [],
        }
      }
    }
  }

  return {
    behavior: 'passthrough',
    message: `Path validation passed for ${baseCommand} command`,
  }
}

function parseCommandPathArgs(command: string): string[] {
  const parsed = parseShellTokens(command)
  if (!parsed.success) return []
  const out: string[] = []
  for (const token of parsed.tokens) {
    if (typeof token === 'string') out.push(restoreShellStringToken(token))
    else if (
      token &&
      typeof token === 'object' &&
      'op' in token &&
      (token as any).op === 'glob' &&
      'pattern' in token
    ) {
      out.push(String((token as any).pattern))
    }
  }
  return out
}

function validateOutputRedirections(
  redirections: Redirection[],
  cwd: string,
  toolPermissionContext: ToolPermissionContext,
  hasCdInCompound: boolean,
): BashPermissionDecision {
  if (hasCdInCompound && redirections.length > 0) {
    return {
      behavior: 'ask',
      message:
        "Commands that change directories and write via output redirection require explicit approval to ensure paths are evaluated correctly. For security, Corint Agent cannot automatically determine the final working directory when 'cd' is used in compound commands.",
      decisionReason: {
        type: 'other',
        reason:
          'Compound command contains cd with output redirection - manual approval required to prevent path resolution bypass',
      },
    }
  }

  for (const { target } of redirections) {
    if (target === '/dev/null') continue
    const check = checkPathArgAllowed(
      target,
      cwd,
      toolPermissionContext,
      'create',
    )
    if (!check.allowed) {
      const allowedDirs = getAllowedWorkingDirectories(toolPermissionContext)
      const formatted = formatAllowedDirs(allowedDirs)
      const message =
        check.decisionReason?.type === 'other'
          ? check.decisionReason.reason
          : check.decisionReason?.type === 'rule'
            ? `Output redirection to '${check.resolvedPath}' was blocked by a deny rule.`
            : `Output redirection to '${check.resolvedPath}' was blocked. For security, ${PRODUCT_NAME} may only write to files in the allowed working directories for this session: ${formatted}.`

      if (check.decisionReason?.type === 'rule') {
        return {
          behavior: 'deny',
          message,
          decisionReason: check.decisionReason,
        }
      }

      return {
        behavior: 'ask',
        message,
        blockedPath: check.resolvedPath,
        suggestions: suggestFilePermissionUpdates({
          inputPath: check.resolvedPath,
          operation: 'create',
          toolPermissionContext,
        }),
      }
    }
  }

  return { behavior: 'passthrough', message: 'No unsafe redirections found' }
}

/**
 * Main entry point for validating paths in bash commands.
 *
 * Validation flow:
 * 1. Check for shell expansion syntax in redirections (requires manual approval)
 * 2. Validate output redirections (>, >>, etc.)
 * 3. Split compound commands and validate each subcommand's paths
 *
 * @param args.command - The full bash command string
 * @param args.cwd - Current working directory for resolving relative paths
 * @param args.toolPermissionContext - Permission rules and allowed directories
 * @param args.hasCdInCompound - Whether the compound command contains 'cd'
 * @returns Permission decision: 'passthrough', 'ask', or 'deny'
 */
export function validateBashCommandPaths(args: {
  command: string
  cwd: string
  toolPermissionContext: ToolPermissionContext
  hasCdInCompound: boolean
}): BashPermissionDecision {
  if (/(?:>>?)\s*\S*[$%]/.test(args.command)) {
    return {
      behavior: 'ask',
      message: 'Shell expansion syntax in paths requires manual approval',
      decisionReason: {
        type: 'other',
        reason: 'Shell expansion syntax in paths requires manual approval',
      },
    }
  }

  const { redirections } = stripOutputRedirections(args.command)
  const redirectionDecision = validateOutputRedirections(
    redirections,
    args.cwd,
    args.toolPermissionContext,
    args.hasCdInCompound,
  )
  if (redirectionDecision.behavior !== 'passthrough') return redirectionDecision

  const subcommands = splitBashCommandIntoSubcommands(args.command)
  for (const subcommand of subcommands) {
    const parts = parseCommandPathArgs(subcommand)
    const [base, ...rest] = parts
    if (!base || !PATH_COMMANDS.has(base)) continue
    const decision = validatePathRestrictedCommand(
      base,
      rest,
      args.cwd,
      args.toolPermissionContext,
      args.hasCdInCompound,
    )
    if (decision.behavior === 'ask' || decision.behavior === 'deny') {
      if (decision.behavior === 'ask' && decision.blockedPath) {
        const op = COMMAND_PATH_BEHAVIOR[base]
        if (op) {
          decision.suggestions = suggestFilePermissionUpdates({
            inputPath: decision.blockedPath,
            operation: op,
            toolPermissionContext: args.toolPermissionContext,
          })
        }
      }
      return decision
    }
  }

  return {
    behavior: 'passthrough',
    message: 'All path commands validated successfully',
  }
}
