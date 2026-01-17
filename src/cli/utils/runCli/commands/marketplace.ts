import { Command } from '@commander-js/extra-typings'

export function registerMarketplaceCommands(marketplaceCmd: Command): void {
  marketplaceCmd
    .command('add <source>')
    .description('Add a marketplace from a URL, path, or GitHub repo')
    .action(async (source: string) => {
      try {
        const { addMarketplace } = await import('@services/skillMarketplace')
        console.log('Adding marketplace...')
        const { name } = await addMarketplace(source)
        console.log(`Successfully added marketplace: ${name}`)
        process.exit(0)
      } catch (error) {
        console.error((error as Error).message)
        process.exit(1)
      }
    })

  marketplaceCmd
    .command('list')
    .description('List all configured marketplaces')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean }) => {
      try {
        const { listMarketplaces } = await import('@services/skillMarketplace')
        const marketplaces = listMarketplaces()

        if (options.json) {
          console.log(JSON.stringify(marketplaces, null, 2))
          process.exit(0)
        }

        const names = Object.keys(marketplaces).sort()
        if (names.length === 0) {
          console.log('No marketplaces configured')
          process.exit(0)
        }

        console.log('Configured marketplaces:\n')
        for (const name of names) {
          const entry = marketplaces[name] as any
          console.log(`  - ${name}`)
          const src = entry?.source
          if (src?.source === 'github') {
            console.log(`    Source: GitHub (${src.repo})`)
          } else if (src?.source === 'git') {
            console.log(`    Source: Git (${src.url})`)
          } else if (src?.source === 'url') {
            console.log(`    Source: URL (${src.url})`)
          } else if (src?.source === 'directory') {
            console.log(`    Source: Directory (${src.path})`)
          } else if (src?.source === 'file') {
            console.log(`    Source: File (${src.path})`)
          } else if (src?.source === 'npm') {
            console.log(`    Source: NPM (${src.package})`)
          }
          console.log('')
        }

        process.exit(0)
      } catch (error) {
        console.error((error as Error).message)
        process.exit(1)
      }
    })

  marketplaceCmd
    .command('remove <name>')
    .alias('rm')
    .description('Remove a configured marketplace')
    .action(async (name: string) => {
      try {
        const { removeMarketplace } = await import('@services/skillMarketplace')
        removeMarketplace(name)
        console.log(`Successfully removed marketplace: ${name}`)
        process.exit(0)
      } catch (error) {
        console.error((error as Error).message)
        process.exit(1)
      }
    })

  marketplaceCmd
    .command('update [name]')
    .description(
      'Update marketplace(s) from their source - updates all if no name specified',
    )
    .action(async (name: string | undefined, _options: any) => {
      try {
        const {
          listMarketplaces,
          refreshAllMarketplacesAsync,
          refreshMarketplaceAsync,
        } = await import('@services/skillMarketplace')

        const trimmed = typeof name === 'string' ? name.trim() : ''
        if (trimmed) {
          console.log(`Updating marketplace: ${trimmed}...`)
          await refreshMarketplaceAsync(trimmed)
          console.log(`Successfully updated marketplace: ${trimmed}`)
          process.exit(0)
        }

        const marketplaces = listMarketplaces()
        const names = Object.keys(marketplaces)
        if (names.length === 0) {
          console.log('No marketplaces configured')
          process.exit(0)
        }

        console.log(`Updating ${names.length} marketplace(s)...`)
        await refreshAllMarketplacesAsync(message => {
          console.log(message)
        })
        console.log(`Successfully updated ${names.length} marketplace(s)`)
        process.exit(0)
      } catch (error) {
        console.error((error as Error).message)
        process.exit(1)
      }
    })
}
