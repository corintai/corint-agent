import { Command } from '@commander-js/extra-typings'

import { getCwd } from '@utils/state'
import {
  handleListApprovedTools,
  handleRemoveApprovedTool,
} from '@commands/approved-tools'

export function registerApprovedToolsCommands(program: Command): void {
  const allowedTools = program
    .command('approved-tools')
    .description('Manage approved tools')

  allowedTools
    .command('list')
    .description('List all approved tools')
    .action(async () => {
      const result = handleListApprovedTools(getCwd())
      console.log(result)
      process.exit(0)
    })

  allowedTools
    .command('remove <tool>')
    .description('Remove a tool from the list of approved tools')
    .action(async (tool: string) => {
      const result = handleRemoveApprovedTool(tool)
      console.log(result.message)
      process.exit(result.success ? 0 : 1)
    })
}
