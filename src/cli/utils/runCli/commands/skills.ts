import { Command } from '@commander-js/extra-typings'
import { cwd } from 'process'

import { registerMarketplaceCommands } from './marketplace'

export function registerSkillCommands(program: Command): void {
  const skillsCmd = program
    .command('skills')
    .description('Manage skills and skill marketplaces')

  const marketplaceCmd = skillsCmd
    .command('marketplace')
    .description(
      'Manage skill marketplaces (.corint-plugin/marketplace.json; legacy .claude-plugin supported)',
    )

  registerMarketplaceCommands(marketplaceCmd)

  skillsCmd
    .command('install <plugin>')
    .description('Install a skill plugin pack (<plugin>@<marketplace>)')
    .option('--cwd <cwd>', 'The current working directory', String, cwd())
    .option('--project', 'Install into this project (.corint/...)', () => true)
    .option('--force', 'Overwrite existing installed files', () => true)
    .action(async (plugin: string, options: any) => {
      try {
        const { setCwd } = await import('@utils/state')
        await setCwd(options.cwd ?? cwd())

        const { installSkillPlugin } = await import('@services/skillMarketplace')
        const result = installSkillPlugin(plugin, {
          project: options.project === true,
          force: options.force === true,
        })
        const skillList =
          result.installedSkills.length > 0
            ? `Skills: ${result.installedSkills.join(', ')}`
            : 'Skills: (none)'
        console.log(`Installed ${plugin}\n${skillList}`)
        process.exit(0)
      } catch (error) {
        console.error((error as Error).message)
        process.exit(1)
      }
    })

  skillsCmd
    .command('uninstall <plugin>')
    .description('Uninstall a skill plugin pack (<plugin>@<marketplace>)')
    .option('--cwd <cwd>', 'The current working directory', String, cwd())
    .option(
      '--project',
      'Uninstall from this project (.corint/...)',
      () => true,
    )
    .action(async (plugin: string, options: any) => {
      try {
        const { setCwd } = await import('@utils/state')
        await setCwd(options.cwd ?? cwd())

        const { uninstallSkillPlugin } = await import('@services/skillMarketplace')
        const result = uninstallSkillPlugin(plugin, {
          project: options.project === true,
        })
        const skillList =
          result.removedSkills.length > 0
            ? `Skills: ${result.removedSkills.join(', ')}`
            : 'Skills: (none)'
        console.log(`Uninstalled ${plugin}\n${skillList}`)
        process.exit(0)
      } catch (error) {
        console.error((error as Error).message)
        process.exit(1)
      }
    })

  skillsCmd
    .command('list-installed')
    .description('List installed skill plugins')
    .action(async () => {
      try {
        const { listInstalledSkillPlugins } = await import('@services/skillMarketplace')
        console.log(JSON.stringify(listInstalledSkillPlugins(), null, 2))
        process.exit(0)
      } catch (error) {
        console.error((error as Error).message)
        process.exit(1)
      }
    })
}
