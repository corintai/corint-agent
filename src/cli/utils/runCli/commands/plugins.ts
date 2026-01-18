import { Command } from '@commander-js/extra-typings'
import { cwd } from 'process'

import { registerMarketplaceCommands } from './marketplace'

export function registerPluginCommands(program: Command): void {
  const pluginCmd = program
    .command('plugin')
    .description('Manage plugins and marketplaces')

  const pluginMarketplaceCmd = pluginCmd
    .command('marketplace')
    .description(
      'Manage marketplaces (.corint-plugin/marketplace.json; legacy .claude-plugin supported)',
    )

  registerMarketplaceCommands(pluginMarketplaceCmd)

  const PLUGIN_SCOPES = ['user', 'project', 'local'] as const
  type PluginScope = (typeof PLUGIN_SCOPES)[number]

  const parsePluginScope = (value: unknown): PluginScope | null => {
    const normalized = String(value || 'user') as PluginScope
    return PLUGIN_SCOPES.includes(normalized) ? normalized : null
  }

  pluginCmd
    .command('install <plugin>')
    .alias('i')
    .description(
      'Install a plugin from available marketplaces (use plugin@marketplace for specific marketplace)',
    )
    .option('--cwd <cwd>', 'The current working directory', String, cwd())
    .option(
      '-s, --scope <scope>',
      'Installation scope: user, project, or local',
      'user',
    )
    .option('--force', 'Overwrite existing installed files', () => true)
    .action(async (plugin: string, options: any) => {
      try {
        const scope = parsePluginScope(options.scope)
        if (!scope) {
          console.error(
            `Invalid scope: ${String(options.scope)}. Must be one of: ${PLUGIN_SCOPES.join(', ')}`,
          )
          process.exit(1)
        }

        const { setCwd } = await import('@utils/state')
        await setCwd(options.cwd ?? cwd())

        const { installSkillPlugin } =
          await import('@services/skillMarketplace')
        const result = installSkillPlugin(plugin, {
          scope,
          force: options.force === true,
        })

        const skillList =
          result.installedSkills.length > 0
            ? `Skills: ${result.installedSkills.join(', ')}`
            : 'Skills: (none)'
        console.log(`Installed ${result.pluginSpec}\n${skillList}`)
        process.exit(0)
      } catch (error) {
        console.error((error as Error).message)
        process.exit(1)
      }
    })

  pluginCmd
    .command('uninstall <plugin>')
    .alias('remove')
    .alias('rm')
    .description('Uninstall an installed plugin')
    .option('--cwd <cwd>', 'The current working directory', String, cwd())
    .option(
      '-s, --scope <scope>',
      `Uninstall from scope: ${PLUGIN_SCOPES.join(', ')} (default: user)`,
      'user',
    )
    .action(async (plugin: string, options: any) => {
      try {
        const scope = parsePluginScope(options.scope)
        if (!scope) {
          console.error(
            `Invalid scope: ${String(options.scope)}. Must be one of: ${PLUGIN_SCOPES.join(', ')}`,
          )
          process.exit(1)
        }

        const { setCwd } = await import('@utils/state')
        await setCwd(options.cwd ?? cwd())

        const { uninstallSkillPlugin } =
          await import('@services/skillMarketplace')
        const result = uninstallSkillPlugin(plugin, { scope })
        const skillList =
          result.removedSkills.length > 0
            ? `Skills: ${result.removedSkills.join(', ')}`
            : 'Skills: (none)'
        console.log(`Uninstalled ${result.pluginSpec}\n${skillList}`)
        process.exit(0)
      } catch (error) {
        console.error((error as Error).message)
        process.exit(1)
      }
    })

  pluginCmd
    .command('list')
    .description('List installed plugins')
    .option('--cwd <cwd>', 'The current working directory', String, cwd())
    .option(
      '-s, --scope <scope>',
      `Filter by scope: ${PLUGIN_SCOPES.join(', ')} (default: user)`,
      'user',
    )
    .option('--json', 'Output as JSON')
    .action(async (options: any) => {
      try {
        const scope = parsePluginScope(options.scope)
        if (!scope) {
          console.error(
            `Invalid scope: ${String(options.scope)}. Must be one of: ${PLUGIN_SCOPES.join(', ')}`,
          )
          process.exit(1)
        }

        const { setCwd, getCwd } = await import('@utils/state')
        await setCwd(options.cwd ?? cwd())

        const { listInstalledSkillPlugins } =
          await import('@services/skillMarketplace')
        const all = listInstalledSkillPlugins()
        const filtered = Object.fromEntries(
          Object.entries(all).filter(([, record]) => {
            if ((record as any)?.scope !== scope) return false
            if (scope === 'user') return true
            return (record as any)?.projectPath === getCwd()
          }),
        )

        if (options.json) {
          console.log(JSON.stringify(filtered, null, 2))
          process.exit(0)
        }

        const names = Object.keys(filtered).sort()
        if (names.length === 0) {
          console.log('No plugins installed')
          process.exit(0)
        }
        console.log(`Installed plugins (scope=${scope}):\n`)
        for (const spec of names) {
          const record = filtered[spec] as any
          const enabled = record?.isEnabled === false ? 'disabled' : 'enabled'
          console.log(`  - ${spec} (${enabled})`)
        }
        process.exit(0)
      } catch (error) {
        console.error((error as Error).message)
        process.exit(1)
      }
    })

  pluginCmd
    .command('enable <plugin>')
    .description('Enable a disabled plugin')
    .option('--cwd <cwd>', 'The current working directory', String, cwd())
    .option(
      '-s, --scope <scope>',
      `Installation scope: ${PLUGIN_SCOPES.join(', ')} (default: user)`,
      'user',
    )
    .action(async (plugin: string, options: any) => {
      try {
        const scope = parsePluginScope(options.scope)
        if (!scope) {
          console.error(
            `Invalid scope: ${String(options.scope)}. Must be one of: ${PLUGIN_SCOPES.join(', ')}`,
          )
          process.exit(1)
        }

        const { setCwd } = await import('@utils/state')
        await setCwd(options.cwd ?? cwd())

        const { enableSkillPlugin } = await import('@services/skillMarketplace')
        const result = enableSkillPlugin(plugin, { scope })
        console.log(`Enabled ${result.pluginSpec}`)
        process.exit(0)
      } catch (error) {
        console.error((error as Error).message)
        process.exit(1)
      }
    })

  pluginCmd
    .command('disable <plugin>')
    .description('Disable an enabled plugin')
    .option('--cwd <cwd>', 'The current working directory', String, cwd())
    .option(
      '-s, --scope <scope>',
      `Installation scope: ${PLUGIN_SCOPES.join(', ')} (default: user)`,
      'user',
    )
    .action(async (plugin: string, options: any) => {
      try {
        const scope = parsePluginScope(options.scope)
        if (!scope) {
          console.error(
            `Invalid scope: ${String(options.scope)}. Must be one of: ${PLUGIN_SCOPES.join(', ')}`,
          )
          process.exit(1)
        }

        const { setCwd } = await import('@utils/state')
        await setCwd(options.cwd ?? cwd())

        const { disableSkillPlugin } =
          await import('@services/skillMarketplace')
        const result = disableSkillPlugin(plugin, { scope })
        console.log(`Disabled ${result.pluginSpec}`)
        process.exit(0)
      } catch (error) {
        console.error((error as Error).message)
        process.exit(1)
      }
    })

  pluginCmd
    .command('validate <path>')
    .description('Validate a plugin or marketplace manifest')
    .option('--cwd <cwd>', 'The current working directory', String, cwd())
    .action(async (path: string, options: any) => {
      try {
        const { setCwd } = await import('@utils/state')
        await setCwd(options.cwd ?? cwd())

        const { formatValidationResult, validatePluginOrMarketplacePath } =
          await import('@services/pluginValidation')

        const result = validatePluginOrMarketplacePath(path)
        console.log(
          `Validating ${result.fileType} manifest: ${result.filePath}\n`,
        )
        console.log(formatValidationResult(result))
        process.exit(result.success ? 0 : 1)
      } catch (error) {
        console.error(
          `Unexpected error during validation: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
        process.exit(2)
      }
    })
}
