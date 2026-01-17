import React from 'react'
import { Command } from '@commander-js/extra-typings'
import type { RenderOptions } from 'ink'
import { cwd } from 'process'

import { LogList } from '@screens/LogList'
import { setup } from '../../setup'

export function registerLogCommands(
  program: Command,
  renderContextWithExitOnCtrlC: RenderOptions | undefined,
): void {
  program
    .command('log')
    .description('Manage conversation logs.')
    .argument(
      '[number]',
      'A number (0, 1, 2, etc.) to display a specific log',
      parseInt,
    )
    .option('--cwd <cwd>', 'The current working directory', String, cwd())
    .action(async (number, { cwd }) => {
      await setup(cwd, false)

      const context: { unmount?: () => void } = {}
      ;(async () => {
        const { render } = await import('ink')
        const { unmount } = render(
          <LogList context={context} type="messages" logNumber={number} />,
          renderContextWithExitOnCtrlC,
        )
        context.unmount = unmount
      })()
    })

  program
    .command('error')
    .description(
      'View error logs. Optionally provide a number (0, -1, -2, etc.) to display a specific log.',
    )
    .argument(
      '[number]',
      'A number (0, 1, 2, etc.) to display a specific log',
      parseInt,
    )
    .option('--cwd <cwd>', 'The current working directory', String, cwd())
    .action(async (number, { cwd }) => {
      await setup(cwd, false)

      const context: { unmount?: () => void } = {}
      ;(async () => {
        const { render } = await import('ink')
        const { unmount } = render(
          <LogList context={context} type="errors" logNumber={number} />,
          renderContextWithExitOnCtrlC,
        )
        context.unmount = unmount
      })()
    })
}
