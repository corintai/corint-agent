import {
  copyFileSync,
  existsSync,
  lstatSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { CONFIG_BASE_DIR } from '@constants/product'
import { getCwd } from '@utils/state'
import type { PluginEntry, PluginScope } from './schemas'
import {
  ensureDir,
  ensureEmptyDir,
  readJsonFile,
  safeCopyDirectory,
  safeJoinWithin,
  writeJsonFile,
} from './fs'
import { getMarketplaceManifest, loadKnownMarketplaces } from './marketplaces'
import { readMarketplaceFromDirectory } from './manifest'
import {
  installedSkillPluginsPath,
  normalizePluginScope,
  scopeCommandsDir,
  scopeDisabledCommandsDir,
  scopeDisabledSkillsDir,
  scopeInstalledPluginRoot,
  scopeSkillsDir,
  userKodeDir,
} from './paths'

type InstalledSkillPlugin = {
  plugin: string
  marketplace: string
  scope: PluginScope
  kind?: 'skill-pack' | 'plugin-pack'
  isEnabled?: boolean
  projectPath?: string
  installedAt: string
  pluginRoot?: string
  skills: string[]
  commands: string[]
  sourceMarketplacePath: string
}

type InstalledSkillPluginsFile = Record<string, InstalledSkillPlugin>

export function parsePluginSpec(spec: string): {
  plugin: string
  marketplace: string
} {
  const trimmed = spec.trim()
  const parts = trimmed.split('@')
  if (parts.length !== 2) {
    throw new Error(
      `Invalid plugin spec: ${spec}. Expected format: <plugin>@<marketplace>`,
    )
  }
  const plugin = parts[0]!.trim()
  const marketplace = parts[1]!.trim()
  if (!plugin || !marketplace) {
    throw new Error(
      `Invalid plugin spec: ${spec}. Expected format: <plugin>@<marketplace>`,
    )
  }
  return { plugin, marketplace }
}

function resolvePluginForInstall(pluginInput: string): {
  plugin: string
  marketplace: string
  pluginSpec: string
} {
  const trimmed = pluginInput.trim()
  if (!trimmed) throw new Error('Plugin is required')

  if (trimmed.includes('@')) {
    const resolved = parsePluginSpec(trimmed)
    return {
      ...resolved,
      pluginSpec: `${resolved.plugin}@${resolved.marketplace}`,
    }
  }

  const config = loadKnownMarketplaces()
  const matches: { marketplace: string; entry: PluginEntry }[] = []
  for (const [marketplace, entry] of Object.entries(config)) {
    try {
      const manifest = readMarketplaceFromDirectory(entry.installLocation)
      const found = manifest.plugins.find(p => p.name === trimmed)
      if (found) matches.push({ marketplace, entry: found })
    } catch {}
  }

  if (matches.length === 0) {
    const availableMarketplaces = Object.keys(config).sort().join(', ')
    throw new Error(
      `Plugin '${trimmed}' not found in any marketplace. Available marketplaces: ${availableMarketplaces || '(none)'}`,
    )
  }

  if (matches.length > 1) {
    const options = matches
      .map(m => `${trimmed}@${m.marketplace}`)
      .sort()
      .join(', ')
    throw new Error(
      `Plugin '${trimmed}' is available in multiple marketplaces. Use an explicit spec: ${options}`,
    )
  }

  return {
    plugin: trimmed,
    marketplace: matches[0]!.marketplace,
    pluginSpec: `${trimmed}@${matches[0]!.marketplace}`,
  }
}

function resolveInstalledPluginSpec(
  pluginInput: string,
  state: InstalledSkillPluginsFile,
): string {
  const trimmed = pluginInput.trim()
  if (!trimmed) throw new Error('Plugin is required')

  if (trimmed.includes('@')) {
    parsePluginSpec(trimmed)
    return trimmed
  }

  const matches = Object.entries(state).filter(
    ([, record]) => record?.plugin === trimmed,
  )
  if (matches.length === 0) {
    throw new Error(`Plugin '${trimmed}' is not installed`)
  }
  if (matches.length > 1) {
    const options = matches
      .map(([spec]) => spec)
      .sort()
      .join(', ')
    throw new Error(
      `Plugin '${trimmed}' is installed from multiple marketplaces. Use an explicit spec: ${options}`,
    )
  }
  return matches[0]![0]
}

function baseDirForInstallRecord(record: InstalledSkillPlugin): string {
  if (record.scope === 'user') return userKodeDir()
  const projectPath =
    typeof record.projectPath === 'string' ? record.projectPath.trim() : ''
  if (!projectPath) {
    throw new Error(
      `Installed plugin '${record.plugin}@${record.marketplace}' is missing projectPath for scope=${record.scope}`,
    )
  }
  return join(projectPath, CONFIG_BASE_DIR)
}

function ensurePluginInstallState(): InstalledSkillPluginsFile {
  ensureDir(userKodeDir())
  const state = readJsonFile<Record<string, any>>(
    installedSkillPluginsPath(),
    {},
  )
  for (const record of Object.values(state)) {
    if (!record || typeof record !== 'object') continue
    if (
      record.scope !== 'user' &&
      record.scope !== 'project' &&
      record.scope !== 'local'
    ) {
      record.scope = 'user'
    }
    if (record.kind !== 'skill-pack' && record.kind !== 'plugin-pack') {
      record.kind =
        typeof record.pluginRoot === 'string' ? 'plugin-pack' : 'skill-pack'
    }
    if (record.isEnabled === undefined) record.isEnabled = true
  }
  return state as InstalledSkillPluginsFile
}

function savePluginInstallState(state: InstalledSkillPluginsFile): void {
  writeJsonFile(installedSkillPluginsPath(), state)
}

export function installSkillPlugin(
  pluginInput: string,
  options?: { scope?: PluginScope; project?: boolean; force?: boolean },
): {
  pluginSpec: string
  installedSkills: string[]
  installedCommands: string[]
} {
  const scope = normalizePluginScope(options)
  const { plugin, marketplace, pluginSpec } =
    resolvePluginForInstall(pluginInput)
  const { manifest, rootDir, source } = getMarketplaceManifest(marketplace)

  const entry = manifest.plugins.find(p => p.name === plugin)
  if (!entry) {
    const available = manifest.plugins
      .map(p => p.name)
      .sort()
      .join(', ')
    throw new Error(
      `Plugin '${plugin}' not found in marketplace '${marketplace}'. Available plugins: ${available || '(none)'}`,
    )
  }

  const installState = ensurePluginInstallState()
  const existing = installState[pluginSpec]
  if (existing && existing.scope !== scope && options?.force !== true) {
    throw new Error(
      `Plugin '${pluginSpec}' is already installed with scope=${existing.scope}. Uninstall it first to install with scope=${scope}.`,
    )
  }
  if (existing && options?.force !== true) {
    throw new Error(
      `Plugin '${pluginSpec}' is already installed. Re-run with --force to reinstall.`,
    )
  }

  const entrySourceBase = resolve(rootDir, entry.source ?? './')
  const primaryManifestPath = join(
    entrySourceBase,
    '.corint-plugin',
    'plugin.json',
  )
  const legacyManifestPath = join(
    entrySourceBase,
    '.claude-plugin',
    'plugin.json',
  )
  const pluginManifestPath = existsSync(primaryManifestPath)
    ? primaryManifestPath
    : legacyManifestPath

  if (
    existsSync(pluginManifestPath) &&
    lstatSync(pluginManifestPath).isFile()
  ) {
    const pluginRoot = scopeInstalledPluginRoot(scope, plugin, marketplace)
    if (existsSync(pluginRoot) && options?.force !== true) {
      throw new Error(`Destination already exists: ${pluginRoot}`)
    }
    ensureEmptyDir(pluginRoot)
    safeCopyDirectory(entrySourceBase, pluginRoot)

    installState[pluginSpec] = {
      plugin,
      marketplace,
      scope,
      kind: 'plugin-pack',
      pluginRoot,
      isEnabled: true,
      projectPath: scope === 'user' ? undefined : getCwd(),
      installedAt: new Date().toISOString(),
      skills: [],
      commands: [],
      sourceMarketplacePath:
        source.source === 'file' || source.source === 'directory'
          ? source.path
          : source.source === 'github'
            ? `github:${source.repo}`
            : source.source === 'url'
              ? source.url
              : source.source === 'git'
                ? source.url
                : `npm:${source.package}`,
    }
    savePluginInstallState(installState)

    return { pluginSpec, installedSkills: [], installedCommands: [] }
  }

  const skillsDestBase = scopeSkillsDir(scope)
  const commandsDestBase = join(scopeCommandsDir(scope), plugin, marketplace)

  ensureDir(skillsDestBase)
  ensureDir(commandsDestBase)

  const installedSkills: string[] = []
  const installedCommands: string[] = []

  const skillPaths = entry.skills ?? []
  for (const rel of skillPaths) {
    const src = safeJoinWithin(entrySourceBase, rel)
    if (!existsSync(src) || !lstatSync(src).isDirectory()) {
      throw new Error(`Skill path not found or not a directory: ${src}`)
    }
    const skillName = basename(src)
    const dest = join(skillsDestBase, skillName)

    if (existsSync(dest) && options?.force !== true) {
      throw new Error(`Destination already exists: ${dest}`)
    }
    ensureEmptyDir(dest)
    safeCopyDirectory(src, dest)
    installedSkills.push(skillName)
  }

  const commandPaths = entry.commands ?? []
  for (const rel of commandPaths) {
    const src = safeJoinWithin(entrySourceBase, rel)
    if (!existsSync(src)) {
      throw new Error(`Command path not found: ${src}`)
    }
    const stat = lstatSync(src)
    if (stat.isDirectory()) {
      const dest = join(commandsDestBase, basename(src))
      if (existsSync(dest) && options?.force !== true) {
        throw new Error(`Destination already exists: ${dest}`)
      }
      ensureEmptyDir(dest)
      safeCopyDirectory(src, dest)
      installedCommands.push(dest)
      continue
    }
    if (stat.isFile()) {
      const dest = join(commandsDestBase, basename(src))
      ensureDir(dirname(dest))
      if (existsSync(dest) && options?.force !== true) {
        throw new Error(`Destination already exists: ${dest}`)
      }
      copyFileSync(src, dest)
      installedCommands.push(dest)
      continue
    }
  }

  installState[pluginSpec] = {
    plugin,
    marketplace,
    scope,
    kind: 'skill-pack',
    isEnabled: true,
    projectPath: scope === 'user' ? undefined : getCwd(),
    installedAt: new Date().toISOString(),
    skills: installedSkills,
    commands: installedCommands,
    sourceMarketplacePath:
      source.source === 'file' || source.source === 'directory'
        ? source.path
        : source.source === 'github'
          ? `github:${source.repo}`
          : source.source === 'url'
            ? source.url
            : source.source === 'git'
              ? source.url
              : `npm:${source.package}`,
  }
  savePluginInstallState(installState)

  return { pluginSpec, installedSkills, installedCommands }
}

export function uninstallSkillPlugin(
  pluginInput: string,
  options?: { scope?: PluginScope; project?: boolean },
): { pluginSpec: string; removedSkills: string[]; removedCommands: string[] } {
  const requestedScope = normalizePluginScope(options)
  const state = ensurePluginInstallState()
  const pluginSpec = resolveInstalledPluginSpec(pluginInput, state)
  const record = state[pluginSpec]
  if (!record) {
    throw new Error(`Plugin '${pluginSpec}' is not installed`)
  }

  if (record.scope !== requestedScope) {
    throw new Error(
      `Plugin '${pluginSpec}' is installed with scope=${record.scope}. Re-run with --scope ${record.scope}.`,
    )
  }
  if (record.scope !== 'user') {
    const projectPath = record.projectPath?.trim() || ''
    const cwd = getCwd()
    if (!projectPath || projectPath !== cwd) {
      throw new Error(
        `Plugin '${pluginSpec}' is installed for a different directory. Expected cwd=${projectPath || '(missing)'}, got cwd=${cwd}`,
      )
    }
  }

  if (record.kind === 'plugin-pack') {
    const baseDir = baseDirForInstallRecord(record)
    const pluginRoot =
      typeof record.pluginRoot === 'string' && record.pluginRoot.trim()
        ? record.pluginRoot
        : join(
            baseDir,
            'plugins',
            'installed',
            record.plugin,
            record.marketplace,
          )

    const removedCommands: string[] = []
    if (existsSync(pluginRoot)) {
      rmSync(pluginRoot, { recursive: true, force: true })
      removedCommands.push(pluginRoot)
    }

    delete state[pluginSpec]
    savePluginInstallState(state)

    return { pluginSpec, removedSkills: [], removedCommands }
  }

  const baseDir = baseDirForInstallRecord(record)
  const skillsDestBase = join(baseDir, 'skills')
  const commandsDestBase = join(
    baseDir,
    'commands',
    record.plugin,
    record.marketplace,
  )
  const disabledSkillsBase = join(
    baseDir,
    'skills.disabled',
    record.plugin,
    record.marketplace,
  )
  const disabledCommandsBase = join(
    baseDir,
    'commands.disabled',
    record.plugin,
    record.marketplace,
  )

  const removedSkills: string[] = []
  for (const skillName of record.skills) {
    const dest = join(skillsDestBase, skillName)
    if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })
    const disabledDest = join(disabledSkillsBase, skillName)
    if (existsSync(disabledDest))
      rmSync(disabledDest, { recursive: true, force: true })
    removedSkills.push(skillName)
  }

  const removedCommands: string[] = []
  if (existsSync(commandsDestBase)) {
    rmSync(commandsDestBase, { recursive: true, force: true })
    removedCommands.push(commandsDestBase)
  }
  if (existsSync(disabledCommandsBase)) {
    rmSync(disabledCommandsBase, { recursive: true, force: true })
    removedCommands.push(disabledCommandsBase)
  }

  delete state[pluginSpec]
  savePluginInstallState(state)

  return { pluginSpec, removedSkills, removedCommands }
}

export function disableSkillPlugin(
  pluginInput: string,
  options?: { scope?: PluginScope; project?: boolean },
): {
  pluginSpec: string
  disabledSkills: string[]
  disabledCommands: string[]
} {
  const requestedScope = normalizePluginScope(options)
  const state = ensurePluginInstallState()
  const pluginSpec = resolveInstalledPluginSpec(pluginInput, state)
  const record = state[pluginSpec]
  if (!record) throw new Error(`Plugin '${pluginSpec}' is not installed`)

  if (record.scope !== requestedScope) {
    throw new Error(
      `Plugin '${pluginSpec}' is installed with scope=${record.scope}. Re-run with --scope ${record.scope}.`,
    )
  }
  if (record.scope !== 'user') {
    const projectPath = record.projectPath?.trim() || ''
    const cwd = getCwd()
    if (!projectPath || projectPath !== cwd) {
      throw new Error(
        `Plugin '${pluginSpec}' is installed for a different directory. Expected cwd=${projectPath || '(missing)'}, got cwd=${cwd}`,
      )
    }
  }

  if (record.isEnabled === false) {
    return { pluginSpec, disabledSkills: [], disabledCommands: [] }
  }

  if (record.kind === 'plugin-pack') {
    record.isEnabled = false
    state[pluginSpec] = record
    savePluginInstallState(state)
    return { pluginSpec, disabledSkills: [], disabledCommands: [] }
  }

  const baseDir = baseDirForInstallRecord(record)
  const skillsDir = join(baseDir, 'skills')
  const commandsDir = join(
    baseDir,
    'commands',
    record.plugin,
    record.marketplace,
  )
  const disabledSkillsBase = join(
    baseDir,
    'skills.disabled',
    record.plugin,
    record.marketplace,
  )
  const disabledCommandsDir = join(
    baseDir,
    'commands.disabled',
    record.plugin,
    record.marketplace,
  )

  const disabledSkills: string[] = []
  for (const skillName of record.skills) {
    const src = join(skillsDir, skillName)
    if (!existsSync(src)) continue
    const dest = join(disabledSkillsBase, skillName)
    ensureDir(dirname(dest))
    if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })
    renameSync(src, dest)
    disabledSkills.push(skillName)
  }

  const disabledCommands: string[] = []
  if (existsSync(commandsDir)) {
    ensureDir(dirname(disabledCommandsDir))
    if (existsSync(disabledCommandsDir)) {
      rmSync(disabledCommandsDir, { recursive: true, force: true })
    }
    renameSync(commandsDir, disabledCommandsDir)
    disabledCommands.push(disabledCommandsDir)
  }

  record.isEnabled = false
  state[pluginSpec] = record
  savePluginInstallState(state)

  return { pluginSpec, disabledSkills, disabledCommands }
}

export function enableSkillPlugin(
  pluginInput: string,
  options?: { scope?: PluginScope; project?: boolean },
): { pluginSpec: string; enabledSkills: string[]; enabledCommands: string[] } {
  const requestedScope = normalizePluginScope(options)
  const state = ensurePluginInstallState()
  const pluginSpec = resolveInstalledPluginSpec(pluginInput, state)
  const record = state[pluginSpec]
  if (!record) throw new Error(`Plugin '${pluginSpec}' is not installed`)

  if (record.scope !== requestedScope) {
    throw new Error(
      `Plugin '${pluginSpec}' is installed with scope=${record.scope}. Re-run with --scope ${record.scope}.`,
    )
  }
  if (record.scope !== 'user') {
    const projectPath = record.projectPath?.trim() || ''
    const cwd = getCwd()
    if (!projectPath || projectPath !== cwd) {
      throw new Error(
        `Plugin '${pluginSpec}' is installed for a different directory. Expected cwd=${projectPath || '(missing)'}, got cwd=${cwd}`,
      )
    }
  }

  if (record.isEnabled !== false) {
    return { pluginSpec, enabledSkills: [], enabledCommands: [] }
  }

  if (record.kind === 'plugin-pack') {
    record.isEnabled = true
    state[pluginSpec] = record
    savePluginInstallState(state)
    return { pluginSpec, enabledSkills: [], enabledCommands: [] }
  }

  const baseDir = baseDirForInstallRecord(record)
  const skillsDir = join(baseDir, 'skills')
  const commandsDir = join(
    baseDir,
    'commands',
    record.plugin,
    record.marketplace,
  )
  const disabledSkillsBase = join(
    baseDir,
    'skills.disabled',
    record.plugin,
    record.marketplace,
  )
  const disabledCommandsDir = join(
    baseDir,
    'commands.disabled',
    record.plugin,
    record.marketplace,
  )

  const enabledSkills: string[] = []
  for (const skillName of record.skills) {
    const src = join(disabledSkillsBase, skillName)
    if (!existsSync(src)) continue
    const dest = join(skillsDir, skillName)
    ensureDir(dirname(dest))
    if (existsSync(dest)) {
      throw new Error(`Destination already exists: ${dest}`)
    }
    renameSync(src, dest)
    enabledSkills.push(skillName)
  }

  const enabledCommands: string[] = []
  if (existsSync(disabledCommandsDir)) {
    ensureDir(dirname(commandsDir))
    if (existsSync(commandsDir)) {
      throw new Error(`Destination already exists: ${commandsDir}`)
    }
    renameSync(disabledCommandsDir, commandsDir)
    enabledCommands.push(commandsDir)
  }

  record.isEnabled = true
  state[pluginSpec] = record
  savePluginInstallState(state)

  return { pluginSpec, enabledSkills, enabledCommands }
}

export function listInstalledSkillPlugins(): InstalledSkillPluginsFile {
  return ensurePluginInstallState()
}

export function listEnabledInstalledPluginPackRoots(): string[] {
  const state = ensurePluginInstallState()
  const cwd = getCwd()
  const roots: string[] = []

  for (const spec of Object.keys(state).sort()) {
    const record = state[spec]
    if (!record || record.kind !== 'plugin-pack') continue
    if (record.isEnabled === false) continue

    if (record.scope !== 'user') {
      const projectPath = record.projectPath?.trim() || ''
      if (!projectPath || projectPath !== cwd) continue
    }

    const baseDir = baseDirForInstallRecord(record)
    const pluginRoot =
      typeof record.pluginRoot === 'string' && record.pluginRoot.trim()
        ? record.pluginRoot
        : join(
            baseDir,
            'plugins',
            'installed',
            record.plugin,
            record.marketplace,
          )

    try {
      if (!existsSync(pluginRoot) || !lstatSync(pluginRoot).isDirectory())
        continue
      roots.push(pluginRoot)
    } catch {
      continue
    }
  }

  return roots
}
