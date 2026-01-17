import { Command } from '@commander-js/extra-typings'
import { cwd } from 'process'

import { getContext, setContext, removeContext } from '@context'
import { setup } from '../../setup'
import { PRODUCT_COMMAND } from '@constants/product'

function omitKeys<T extends Record<string, any>>(
  input: T,
  ...keys: (keyof T | string)[]
): Partial<T> {
  const result = { ...input } as Partial<T>
  for (const key of keys) {
    delete (result as any)[key as any]
  }
  return result
}

export function registerContextCommands(program: Command): void {
  const context = program
    .command('context')
    .description(
      `Set static context (eg. ${PRODUCT_COMMAND} context add-file ./src/*.py)`,
    )

  context
    .command('get <key>')
    .option('--cwd <cwd>', 'The current working directory', String, cwd())
    .description('Get a value from context')
    .action(async (key, { cwd }) => {
      await setup(cwd, false)

      const context = omitKeys(
        await getContext(),
        'codeStyle',
        'directoryStructure',
      )
      console.log(context[key])
      process.exit(0)
    })

  context
    .command('set <key> <value>')
    .description('Set a value in context')
    .option('--cwd <cwd>', 'The current working directory', String, cwd())
    .action(async (key, value, { cwd }) => {
      await setup(cwd, false)

      setContext(key, value)
      console.log(`Set context.${key} to "${value}"`)
      process.exit(0)
    })

  context
    .command('list')
    .description('List all context values')
    .option('--cwd <cwd>', 'The current working directory', String, cwd())
    .action(async ({ cwd }) => {
      await setup(cwd, false)

      const context = omitKeys(
        await getContext(),
        'codeStyle',
        'directoryStructure',
        'gitStatus',
      )
      console.log(JSON.stringify(context, null, 2))
      process.exit(0)
    })

  context
    .command('remove <key>')
    .description('Remove a value from context')
    .option('--cwd <cwd>', 'The current working directory', String, cwd())
    .action(async (key, { cwd }) => {
      await setup(cwd, false)

      removeContext(key)
      console.log(`Removed context.${key}`)
      process.exit(0)
    })
}
