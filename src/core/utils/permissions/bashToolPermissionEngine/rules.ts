import type {
  ToolPermissionContext,
  ToolPermissionContextUpdate,
} from '@kode-types/toolPermissionContext'
import { PRODUCT_NAME } from '@constants/product'

import type { BashPermissionDecision } from './types'
import { stripOutputRedirections } from './redirections'

type ToolRuleValue = { toolName: string; ruleContent?: string }

type BashRuleMatchType = 'exact' | 'prefix'

type ParsedBashRuleContent =
  | { type: 'exact'; command: string }
  | { type: 'prefix'; prefix: string }

function parseToolRuleString(rule: string): ToolRuleValue | null {
  if (typeof rule !== 'string') return null
  const trimmed = rule.trim()
  if (!trimmed) return null
  const open = trimmed.indexOf('(')
  if (open === -1) return { toolName: trimmed }
  if (!trimmed.endsWith(')')) return null
  const toolName = trimmed.slice(0, open)
  const ruleContent = trimmed.slice(open + 1, -1)
  if (!toolName) return null
  return { toolName, ruleContent: ruleContent || undefined }
}

function parseBashRuleContent(ruleContent: string): ParsedBashRuleContent {
  const normalized = ruleContent.trim().replace(/\s*\[background\]\s*$/i, '')
  const match = normalized.match(/^(.+):\*$/)
  if (match && match[1]) return { type: 'prefix', prefix: match[1] }
  return { type: 'exact', command: normalized }
}

function collectBashRuleStrings(
  context: ToolPermissionContext,
  behavior: 'allow' | 'deny' | 'ask',
): string[] {
  const groups =
    behavior === 'allow'
      ? context.alwaysAllowRules
      : behavior === 'deny'
        ? context.alwaysDenyRules
        : context.alwaysAskRules
  const out: string[] = []
  for (const rules of Object.values(groups)) {
    if (!Array.isArray(rules)) continue
    for (const rule of rules) if (typeof rule === 'string') out.push(rule)
  }
  return out
}

function findMatchingBashRules(args: {
  command: string
  toolPermissionContext: ToolPermissionContext
  behavior: 'allow' | 'deny' | 'ask'
  matchType: BashRuleMatchType
}): string[] {
  const trimmed = args.command.trim()
  const withoutRedirections =
    stripOutputRedirections(trimmed).commandWithoutRedirections
  const candidates =
    args.matchType === 'exact'
      ? [trimmed, withoutRedirections]
      : [trimmed, withoutRedirections].flatMap(cmd =>
          cmd.split('&&').flatMap(part => part.trim()),
        )
  const rules = collectBashRuleStrings(args.toolPermissionContext, args.behavior)
  const matches: string[] = []
  for (const rule of rules) {
    const parsed = parseToolRuleString(rule)
    if (!parsed || parsed.toolName !== 'Bash' || !parsed.ruleContent) continue
    const content = parseBashRuleContent(parsed.ruleContent)
    if (content.type === 'exact') {
      if (args.matchType !== 'exact') continue
      if (candidates.includes(content.command)) matches.push(rule)
    } else {
      if (args.matchType !== 'prefix') continue
      if (
        candidates.some(cmd => cmd.startsWith(content.prefix)) ||
        candidates.some(cmd => cmd.startsWith(`${content.prefix} `))
      ) {
        matches.push(rule)
      }
    }
  }
  return matches
}

export function buildBashRuleSuggestionExact(
  command: string,
): ToolPermissionContextUpdate[] {
  return [
    {
      type: 'addRules',
      destination: 'localSettings',
      behavior: 'allow',
      rules: [`Bash(${command})`],
    },
  ]
}

export function buildBashRuleSuggestionPrefix(
  prefix: string,
): ToolPermissionContextUpdate[] {
  return [
    {
      type: 'addRules',
      destination: 'localSettings',
      behavior: 'allow',
      rules: [`Bash(${prefix}:*)`],
    },
  ]
}

export function checkExactBashRules(
  command: string,
  toolPermissionContext: ToolPermissionContext,
): BashPermissionDecision {
  const trimmed = command.trim()
  const denyRules = findMatchingBashRules({
    command: trimmed,
    toolPermissionContext,
    behavior: 'deny',
    matchType: 'exact',
  })
  if (denyRules[0]) {
    return {
      behavior: 'deny',
      message: `Permission to use Bash with command ${trimmed} has been denied.`,
      decisionReason: { type: 'rule', rule: denyRules[0] },
    }
  }

  const askRules = findMatchingBashRules({
    command: trimmed,
    toolPermissionContext,
    behavior: 'ask',
    matchType: 'exact',
  })
  if (askRules[0]) {
    return {
      behavior: 'ask',
      message: `${PRODUCT_NAME} requested permissions to use Bash, but you haven't granted it yet.`,
      decisionReason: { type: 'rule', rule: askRules[0] },
    }
  }

  const allowRules = findMatchingBashRules({
    command: trimmed,
    toolPermissionContext,
    behavior: 'allow',
    matchType: 'exact',
  })
  if (allowRules[0]) {
    return {
      behavior: 'allow',
      updatedInput: { command: trimmed },
      decisionReason: { type: 'rule', rule: allowRules[0] },
    }
  }

  return {
    behavior: 'passthrough',
    message: `${PRODUCT_NAME} requested permissions to use Bash, but you haven't granted it yet.`,
    decisionReason: { type: 'other', reason: 'This command requires approval' },
    suggestions: buildBashRuleSuggestionExact(trimmed),
  }
}

export function checkPrefixBashRules(
  command: string,
  toolPermissionContext: ToolPermissionContext,
): { deny?: string; ask?: string; allow?: string } {
  const deny = findMatchingBashRules({
    command,
    toolPermissionContext,
    behavior: 'deny',
    matchType: 'prefix',
  })[0]
  const ask = findMatchingBashRules({
    command,
    toolPermissionContext,
    behavior: 'ask',
    matchType: 'prefix',
  })[0]
  const allow = findMatchingBashRules({
    command,
    toolPermissionContext,
    behavior: 'allow',
    matchType: 'prefix',
  })[0]
  return { deny, ask, allow }
}

const ACCEPT_EDITS_AUTO_ALLOW_BASE_COMMANDS = new Set([
  'mkdir',
  'touch',
  'rm',
  'rmdir',
  'mv',
  'cp',
  'sed',
])

export function modeSpecificBashDecision(
  command: string,
  toolPermissionContext: ToolPermissionContext,
): BashPermissionDecision {
  if (toolPermissionContext.mode !== 'acceptEdits') {
    return {
      behavior: 'passthrough',
      message: 'No mode-specific validation required',
    }
  }
  const base = command.trim().split(/\s+/)[0] ?? ''
  if (!base)
    return { behavior: 'passthrough', message: 'Base command not found' }
  if (ACCEPT_EDITS_AUTO_ALLOW_BASE_COMMANDS.has(base)) {
    return {
      behavior: 'allow',
      updatedInput: { command },
      decisionReason: {
        type: 'other',
        reason: 'Auto-allowed in acceptEdits mode',
      },
    }
  }
  return {
    behavior: 'passthrough',
    message: `No mode-specific handling for '${base}' in ${toolPermissionContext.mode} mode`,
  }
}
