import { Command } from '@commander-js/extra-typings'

import React from 'react'
import { Doctor } from '@screens/Doctor'
import { PRODUCT_NAME } from '@constants/product'

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description(`Check the health of your ${PRODUCT_NAME} installation`)
    .action(async () => {
      await new Promise<void>(resolve => {
        ;(async () => {
          const { render } = await import('ink')
          render(<Doctor onDone={() => resolve()} doctorMode={true} />)
        })()
      })
      process.exit(0)
    })
}
