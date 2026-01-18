import { join } from 'node:path'
import { CONFIG_BASE_DIR } from '@constants/product'
import { getCwd } from '@utils/state'
import { getCorintBaseDir } from '@utils/config/env'
import {
  INSTALLED_SKILL_PLUGINS_FILE,
  KNOWN_MARKETPLACES_FILE,
  MARKETPLACES_CACHE_DIR,
} from './constants'
import type { PluginScope } from './schemas'

export function userKodeDir(): string {
  return getCorintBaseDir()
}

export function normalizePluginScope(options?: {
  scope?: PluginScope
  project?: boolean
}): PluginScope {
  if (
    options?.scope === 'user' ||
    options?.scope === 'project' ||
    options?.scope === 'local'
  ) {
    return options.scope
  }
  if (options?.project === true) return 'project'
  return 'user'
}

export function scopeBaseDir(scope: PluginScope): string {
  if (scope === 'user') return userKodeDir()
  return join(getCwd(), CONFIG_BASE_DIR)
}

export function scopeSkillsDir(scope: PluginScope): string {
  return join(scopeBaseDir(scope), 'skills')
}

export function scopeCommandsDir(scope: PluginScope): string {
  return join(scopeBaseDir(scope), 'commands')
}

export function scopeDisabledSkillsDir(scope: PluginScope): string {
  return join(scopeBaseDir(scope), 'skills.disabled')
}

export function scopeDisabledCommandsDir(scope: PluginScope): string {
  return join(scopeBaseDir(scope), 'commands.disabled')
}

export function scopeInstalledPluginsDir(scope: PluginScope): string {
  return join(scopeBaseDir(scope), 'plugins', 'installed')
}

export function scopeInstalledPluginRoot(
  scope: PluginScope,
  plugin: string,
  marketplace: string,
): string {
  return join(scopeInstalledPluginsDir(scope), plugin, marketplace)
}

export function pluginsDir(): string {
  return join(userKodeDir(), 'plugins')
}

export function knownMarketplacesConfigPath(): string {
  return join(pluginsDir(), KNOWN_MARKETPLACES_FILE)
}

export function marketplaceCacheBaseDir(): string {
  return join(pluginsDir(), MARKETPLACES_CACHE_DIR)
}

export function installedSkillPluginsPath(): string {
  return join(userKodeDir(), INSTALLED_SKILL_PLUGINS_FILE)
}
