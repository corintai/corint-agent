import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { dirname, join } from 'path'
import { homedir } from 'os'
import { memoize } from 'lodash-es'
import type { MessageParam } from '@anthropic-ai/sdk/resources/index.mjs'
import type { Command } from '@commands'
import { getCwd } from '@utils/state'
import { getSessionPlugins } from '@utils/session/sessionPlugins'
import { getCorintBaseDir } from '@utils/config/env'
import { debug as debugLogger } from '@utils/log/debugLogger'
import { logError } from '@utils/log'
import {
  buildPluginQualifiedName,
  isSkillMarkdownFile,
  nameForCommandFile,
  nameForPluginCommandFile,
  sourceLabel,
} from './commandUtils'
import {
  extractDescriptionFromMarkdown,
  parseAllowedTools,
  parseFrontmatter,
  parseMaxThinkingTokens,
  toBoolean,
} from './frontmatterParser'
import type {
  CommandFileRecord,
  CommandSource,
  CustomCommandFrontmatter,
  CustomCommandWithScope,
} from './types'

export { executeBashCommands, resolveFileReferences } from './commandUtils'
export { parseFrontmatter } from './frontmatterParser'
export type {
  CommandSource,
  CustomCommandFile,
  CustomCommandFrontmatter,
  CustomCommandWithScope,
} from './types'

function getUserCorintBaseDir(): string {
  return getCorintBaseDir()
}

function createPluginPromptCommandFromFile(record: {
  pluginName: string
  commandsDir: string
  filePath: string
  frontmatter: CustomCommandFrontmatter
  content: string
}): CustomCommandWithScope | null {
  const name = nameForPluginCommandFile(
    record.filePath,
    record.commandsDir,
    record.pluginName,
  )
  if (!name) return null

  const descriptionText =
    record.frontmatter.description ??
    extractDescriptionFromMarkdown(record.content, 'Custom command')
  const allowedTools = parseAllowedTools(record.frontmatter['allowed-tools'])
  const maxThinkingTokens = parseMaxThinkingTokens(record.frontmatter)
  const argumentHint = record.frontmatter['argument-hint']
  const whenToUse = record.frontmatter.when_to_use
  const version = record.frontmatter.version
  const disableModelInvocation = toBoolean(
    record.frontmatter['disable-model-invocation'],
  )
  const model =
    record.frontmatter.model === 'inherit'
      ? undefined
      : record.frontmatter.model

  return {
    type: 'prompt',
    name,
    description: `${descriptionText} (${sourceLabel('pluginDir')})`,
    isEnabled: true,
    isHidden: false,
    filePath: record.filePath,
    aliases: [],
    progressMessage: 'running',
    allowedTools,
    maxThinkingTokens,
    argumentHint,
    whenToUse,
    version,
    model,
    isSkill: false,
    disableModelInvocation,
    hasUserSpecifiedDescription: !!record.frontmatter.description,
    source: 'pluginDir',
    scope: 'project',
    userFacingName() {
      return name
    },
    async getPromptForCommand(args: string): Promise<MessageParam[]> {
      let prompt = record.content
      const trimmedArgs = args.trim()
      if (trimmedArgs) {
        if (prompt.includes('$ARGUMENTS')) {
          prompt = prompt.replaceAll('$ARGUMENTS', trimmedArgs)
        } else {
          prompt = `${prompt}\n\nARGUMENTS: ${trimmedArgs}`
        }
      }
      return [{ role: 'user', content: prompt }]
    },
  }
}

function loadPluginCommandsFromDir(args: {
  pluginName: string
  commandsDir: string
  signal: AbortSignal
}): CustomCommandWithScope[] {
  let commandsBaseDir = args.commandsDir
  let files: string[] = []
  try {
    const st = statSync(args.commandsDir)
    if (st.isFile()) {
      if (!args.commandsDir.toLowerCase().endsWith('.md')) return []
      files = [args.commandsDir]
      commandsBaseDir = dirname(args.commandsDir)
    } else if (st.isDirectory()) {
      files = listMarkdownFilesRecursively(args.commandsDir, args.signal)
    } else {
      return []
    }
  } catch {
    return []
  }

  const out: CustomCommandWithScope[] = []
  for (const filePath of files) {
    if (args.signal.aborted) break
    try {
      const raw = readFileSync(filePath, 'utf8')
      const { frontmatter, content } = parseFrontmatter(raw)
      const cmd = createPluginPromptCommandFromFile({
        pluginName: args.pluginName,
        commandsDir: commandsBaseDir,
        filePath,
        frontmatter,
        content,
      })
      if (cmd) out.push(cmd)
    } catch {}
  }
  return out
}

function loadPluginSkillDirectoryCommandsFromBaseDir(args: {
  pluginName: string
  skillsDir: string
}): CustomCommandWithScope[] {
  if (!existsSync(args.skillsDir)) return []

  const out: CustomCommandWithScope[] = []
  let entries
  try {
    entries = readdirSync(args.skillsDir, { withFileTypes: true })
  } catch {
    return []
  }

  const strictMode = toBoolean(process.env.KODE_SKILLS_STRICT)
  const validateName = (skillName: string): boolean => {
    if (skillName.length < 1 || skillName.length > 64) return false
    return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skillName)
  }

  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    const skillDir = join(args.skillsDir, entry.name)
    const skillFileCandidates = [
      join(skillDir, 'SKILL.md'),
      join(skillDir, 'skill.md'),
    ]
    const skillFile = skillFileCandidates.find(p => existsSync(p))
    if (!skillFile) continue

    try {
      const raw = readFileSync(skillFile, 'utf8')
      const { frontmatter, content } = parseFrontmatter(raw)

      const dirName = entry.name
      const declaredName =
        typeof (frontmatter as any).name === 'string'
          ? String((frontmatter as any).name).trim()
          : ''
      const effectiveDeclaredName =
        declaredName && declaredName === dirName ? declaredName : ''
      if (declaredName && declaredName !== dirName) {
        if (strictMode) continue
        debugLogger.warn('CUSTOM_COMMAND_SKILL_NAME_MISMATCH', {
          dirName,
          declaredName,
          skillFile,
        })
      }
      const name = buildPluginQualifiedName(args.pluginName, dirName)
      if (!validateName(dirName)) {
        if (strictMode) continue
        debugLogger.warn('CUSTOM_COMMAND_SKILL_DIR_INVALID', {
          dirName,
          skillFile,
        })
      }
      const descriptionText =
        frontmatter.description ??
        extractDescriptionFromMarkdown(content, 'Skill')
      if (strictMode) {
        const d =
          typeof frontmatter.description === 'string'
            ? frontmatter.description.trim()
            : ''
        if (!d || d.length > 1024) continue
      }

      const allowedTools = parseAllowedTools(frontmatter['allowed-tools'])
      const maxThinkingTokens = parseMaxThinkingTokens(frontmatter as any)
      const argumentHint = frontmatter['argument-hint']
      const whenToUse = frontmatter.when_to_use
      const version = frontmatter.version
      const disableModelInvocation = toBoolean(
        frontmatter['disable-model-invocation'],
      )
      const model =
        frontmatter.model === 'inherit' ? undefined : frontmatter.model

      out.push({
        type: 'prompt',
        name,
        description: `${descriptionText} (${sourceLabel('pluginDir')})`,
        isEnabled: true,
        isHidden: true,
        aliases: [],
        filePath: skillFile,
        progressMessage: 'loading',
        allowedTools,
        maxThinkingTokens,
        argumentHint,
        whenToUse,
        version,
        model,
        isSkill: true,
        disableModelInvocation,
        hasUserSpecifiedDescription: !!frontmatter.description,
        source: 'pluginDir',
        scope: 'project',
        userFacingName() {
          return effectiveDeclaredName
            ? buildPluginQualifiedName(args.pluginName, effectiveDeclaredName)
            : name
        },
        async getPromptForCommand(argsText: string): Promise<MessageParam[]> {
          let prompt = `Base directory for this skill: ${skillDir}\n\n${content}`
          const trimmedArgs = argsText.trim()
          if (trimmedArgs) {
            if (prompt.includes('$ARGUMENTS')) {
              prompt = prompt.replaceAll('$ARGUMENTS', trimmedArgs)
            } else {
              prompt = `${prompt}\n\nARGUMENTS: ${trimmedArgs}`
            }
          }
          return [{ role: 'user', content: prompt }]
        },
      })
    } catch {}
  }

  return out
}

function applySkillFilePreference(
  files: CommandFileRecord[],
): CommandFileRecord[] {
  const grouped = new Map<string, CommandFileRecord[]>()
  for (const file of files) {
    const key = dirname(file.filePath)
    const existing = grouped.get(key) ?? []
    existing.push(file)
    grouped.set(key, existing)
  }

  const result: CommandFileRecord[] = []
  for (const group of grouped.values()) {
    const skillFiles = group.filter(f => isSkillMarkdownFile(f.filePath))
    if (skillFiles.length > 0) {
      result.push(skillFiles[0]!)
      continue
    }
    result.push(...group)
  }
  return result
}

function createPromptCommandFromFile(
  record: CommandFileRecord,
): CustomCommandWithScope | null {
  const isSkill = isSkillMarkdownFile(record.filePath)
  const name = nameForCommandFile(record.filePath, record.baseDir)
  if (!name) return null

  const descriptionText =
    record.frontmatter.description ??
    extractDescriptionFromMarkdown(
      record.content,
      isSkill ? 'Skill' : 'Custom command',
    )

  const allowedTools = parseAllowedTools(record.frontmatter['allowed-tools'])
  const maxThinkingTokens = parseMaxThinkingTokens(record.frontmatter)
  const argumentHint = record.frontmatter['argument-hint']
  const whenToUse = record.frontmatter.when_to_use
  const version = record.frontmatter.version
  const disableModelInvocation = toBoolean(
    record.frontmatter['disable-model-invocation'],
  )
  const model =
    record.frontmatter.model === 'inherit'
      ? undefined
      : record.frontmatter.model

  const description = `${descriptionText} (${sourceLabel(record.source)})`
  const progressMessage = isSkill ? 'loading' : 'running'
  const skillBaseDir = isSkill ? dirname(record.filePath) : undefined

  return {
    type: 'prompt',
    name,
    description,
    isEnabled: true,
    isHidden: false,
    filePath: record.filePath,
    aliases: [],
    progressMessage,
    allowedTools,
    maxThinkingTokens,
    argumentHint,
    whenToUse,
    version,
    model,
    isSkill,
    disableModelInvocation,
    hasUserSpecifiedDescription: !!record.frontmatter.description,
    source: record.source,
    scope: record.scope,
    userFacingName() {
      return name
    },
    async getPromptForCommand(args: string): Promise<MessageParam[]> {
      let prompt = record.content
      if (isSkill && skillBaseDir) {
        prompt = `Base directory for this skill: ${skillBaseDir}\n\n${prompt}`
      }
      const trimmedArgs = args.trim()
      if (trimmedArgs) {
        if (prompt.includes('$ARGUMENTS')) {
          prompt = prompt.replaceAll('$ARGUMENTS', trimmedArgs)
        } else {
          prompt = `${prompt}\n\nARGUMENTS: ${trimmedArgs}`
        }
      }
      return [{ role: 'user', content: prompt }]
    },
  }
}

function listMarkdownFilesRecursively(
  baseDir: string,
  signal: AbortSignal,
): string[] {
  const results: string[] = []
  const queue: string[] = [baseDir]
  while (queue.length > 0) {
    if (signal.aborted) break
    const currentDir = queue.pop()!
    let entries
    try {
      entries = readdirSync(currentDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (signal.aborted) break
      const fullPath = join(currentDir, entry.name)
      if (entry.isDirectory()) {
        queue.push(fullPath)
        continue
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        results.push(fullPath)
      }
    }
  }
  return results
}

function loadCommandMarkdownFilesFromBaseDir(
  baseDir: string,
  source: CommandSource,
  scope: 'user' | 'project',
  signal: AbortSignal,
): CommandFileRecord[] {
  if (!existsSync(baseDir)) return []
  const files = listMarkdownFilesRecursively(baseDir, signal)
  const records: CommandFileRecord[] = []
  for (const filePath of files) {
    if (signal.aborted) break
    try {
      const raw = readFileSync(filePath, 'utf8')
      const { frontmatter, content } = parseFrontmatter(raw)
      records.push({ baseDir, filePath, frontmatter, content, source, scope })
    } catch {}
  }
  return records
}

function loadSkillDirectoryCommandsFromBaseDir(
  skillsDir: string,
  source: CommandSource,
  scope: 'user' | 'project',
): CustomCommandWithScope[] {
  if (!existsSync(skillsDir)) return []

  const out: CustomCommandWithScope[] = []
  let entries
  try {
    entries = readdirSync(skillsDir, { withFileTypes: true })
  } catch {
    return []
  }

  const strictMode = toBoolean(process.env.KODE_SKILLS_STRICT)
  const validateName = (skillName: string): boolean => {
    if (skillName.length < 1 || skillName.length > 64) return false
    return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skillName)
  }

  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    const skillDir = join(skillsDir, entry.name)
    const skillFileCandidates = [
      join(skillDir, 'SKILL.md'),
      join(skillDir, 'skill.md'),
    ]
    const skillFile = skillFileCandidates.find(p => existsSync(p))
    if (!skillFile) continue

    try {
      const raw = readFileSync(skillFile, 'utf8')
      const { frontmatter, content } = parseFrontmatter(raw)

      const dirName = entry.name
      const declaredName =
        typeof (frontmatter as any).name === 'string'
          ? String((frontmatter as any).name).trim()
          : ''
      const effectiveDeclaredName =
        declaredName && declaredName === dirName ? declaredName : ''
      if (declaredName && declaredName !== dirName) {
        if (strictMode) continue
        debugLogger.warn('CUSTOM_COMMAND_SKILL_NAME_MISMATCH', {
          dirName,
          declaredName,
          skillFile,
        })
      }
      const name = dirName
      if (!validateName(name)) {
        if (strictMode) continue
        debugLogger.warn('CUSTOM_COMMAND_SKILL_DIR_INVALID', {
          name,
          skillFile,
        })
      }
      const descriptionText =
        frontmatter.description ??
        extractDescriptionFromMarkdown(content, 'Skill')
      if (strictMode) {
        const d =
          typeof frontmatter.description === 'string'
            ? frontmatter.description.trim()
            : ''
        if (!d || d.length > 1024) continue
      }

      const allowedTools = parseAllowedTools(frontmatter['allowed-tools'])
      const maxThinkingTokens = parseMaxThinkingTokens(frontmatter as any)
      const argumentHint = frontmatter['argument-hint']
      const whenToUse = frontmatter.when_to_use
      const version = frontmatter.version
      const disableModelInvocation = toBoolean(
        frontmatter['disable-model-invocation'],
      )
      const model =
        frontmatter.model === 'inherit' ? undefined : frontmatter.model

      out.push({
        type: 'prompt',
        name,
        description: `${descriptionText} (${sourceLabel(source)})`,
        isEnabled: true,
        isHidden: true,
        aliases: [],
        filePath: skillFile,
        progressMessage: 'loading',
        allowedTools,
        maxThinkingTokens,
        argumentHint,
        whenToUse,
        version,
        model,
        isSkill: true,
        disableModelInvocation,
        hasUserSpecifiedDescription: !!frontmatter.description,
        source,
        scope,
        userFacingName() {
          return effectiveDeclaredName || name
        },
        async getPromptForCommand(args: string): Promise<MessageParam[]> {
          let prompt = `Base directory for this skill: ${skillDir}\n\n${content}`
          const trimmedArgs = args.trim()
          if (trimmedArgs) {
            if (prompt.includes('$ARGUMENTS')) {
              prompt = prompt.replaceAll('$ARGUMENTS', trimmedArgs)
            } else {
              prompt = `${prompt}\n\nARGUMENTS: ${trimmedArgs}`
            }
          }
          return [{ role: 'user', content: prompt }]
        },
      })
    } catch {}
  }

  return out
}

export const loadCustomCommands = memoize(
  async (): Promise<CustomCommandWithScope[]> => {
    const cwd = getCwd()
    const userCorintBaseDir = getUserCorintBaseDir()
    const sessionPlugins = getSessionPlugins()

    const projectLegacyCommandsDir = join(cwd, '.claude', 'commands')
    const userLegacyCommandsDir = join(homedir(), '.claude', 'commands')
    const projectCorintCommandsDir = join(cwd, '.corint', 'commands')
    const userCorintCommandsDir = join(userCorintBaseDir, 'commands')

    const projectLegacySkillsDir = join(cwd, '.claude', 'skills')
    const userLegacySkillsDir = join(homedir(), '.claude', 'skills')
    const projectCorintSkillsDir = join(cwd, '.corint', 'skills')
    const userCorintSkillsDir = join(userCorintBaseDir, 'skills')

    const abortController = new AbortController()
    const timeout = setTimeout(() => abortController.abort(), 3000)

    try {
      const commandFiles = applySkillFilePreference([
        ...loadCommandMarkdownFilesFromBaseDir(
          projectLegacyCommandsDir,
          'localSettings',
          'project',
          abortController.signal,
        ),
        ...loadCommandMarkdownFilesFromBaseDir(
          projectCorintCommandsDir,
          'localSettings',
          'project',
          abortController.signal,
        ),
        ...loadCommandMarkdownFilesFromBaseDir(
          userLegacyCommandsDir,
          'userSettings',
          'user',
          abortController.signal,
        ),
        ...loadCommandMarkdownFilesFromBaseDir(
          userCorintCommandsDir,
          'userSettings',
          'user',
          abortController.signal,
        ),
      ])

      const fileCommands = commandFiles
        .map(createPromptCommandFromFile)
        .filter((cmd): cmd is CustomCommandWithScope => cmd !== null)

      const skillDirCommands: CustomCommandWithScope[] = [
        ...loadSkillDirectoryCommandsFromBaseDir(
          projectLegacySkillsDir,
          'localSettings',
          'project',
        ),
        ...loadSkillDirectoryCommandsFromBaseDir(
          projectCorintSkillsDir,
          'localSettings',
          'project',
        ),
        ...loadSkillDirectoryCommandsFromBaseDir(
          userLegacySkillsDir,
          'userSettings',
          'user',
        ),
        ...loadSkillDirectoryCommandsFromBaseDir(
          userCorintSkillsDir,
          'userSettings',
          'user',
        ),
      ]

      const pluginCommands: CustomCommandWithScope[] = []
      if (sessionPlugins.length > 0) {
        for (const plugin of sessionPlugins) {
          for (const commandsDir of plugin.commandsDirs) {
            pluginCommands.push(
              ...loadPluginCommandsFromDir({
                pluginName: plugin.name,
                commandsDir,
                signal: abortController.signal,
              }),
            )
          }
          for (const skillsDir of plugin.skillsDirs) {
            pluginCommands.push(
              ...loadPluginSkillDirectoryCommandsFromBaseDir({
                pluginName: plugin.name,
                skillsDir,
              }),
            )
          }
        }
      }

      const ordered = [
        ...fileCommands,
        ...skillDirCommands,
        ...pluginCommands,
      ].filter(cmd => cmd.isEnabled)

      const seen = new Set<string>()
      const unique: CustomCommandWithScope[] = []
      for (const cmd of ordered) {
        const key = cmd.userFacingName()
        if (seen.has(key)) continue
        seen.add(key)
        unique.push(cmd)
      }

      return unique
    } catch (error) {
      logError(error)
      debugLogger.warn('CUSTOM_COMMANDS_LOAD_FAILED', {
        error: error instanceof Error ? error.message : String(error),
      })
      return []
    } finally {
      clearTimeout(timeout)
    }
  },
  () => {
    const cwd = getCwd()
    const userCorintBaseDir = getUserCorintBaseDir()
    const dirs = [
      join(homedir(), '.claude', 'commands'),
      join(cwd, '.claude', 'commands'),
      join(userCorintBaseDir, 'commands'),
      join(cwd, '.corint', 'commands'),
      join(homedir(), '.claude', 'skills'),
      join(cwd, '.claude', 'skills'),
      join(userCorintBaseDir, 'skills'),
      join(cwd, '.corint', 'skills'),
    ]
    const exists = dirs.map(d => (existsSync(d) ? '1' : '0')).join('')
    return `${cwd}:${exists}:${Math.floor(Date.now() / 60000)}`
  },
)

export const reloadCustomCommands = (): void => {
  loadCustomCommands.cache.clear()
}

export { getCustomCommandDirectories, hasCustomCommands } from './customCommandDirectories'
