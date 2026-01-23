import React from 'react'
import { render } from 'ink'
import { ModelConfig } from '@components/ModelConfig'
import { enableConfigs } from '@utils/config'
import { reloadModelManager } from '@utils/model'
import { triggerModelConfigChange } from '@messages'

export const help = 'Select configured models for model pointers'
export const description = 'Select configured models for model pointers'
export const isEnabled = true
export const isHidden = false
export const name = 'model'
export const type = 'local-jsx'

export function userFacingName(): string {
  return name
}

export async function call(
  onDone: (result?: string) => void,
  context: any,
): Promise<React.ReactNode> {
  const { abortController } = context
  enableConfigs()
  reloadModelManager()
  abortController?.abort?.()
  return (
    <ModelConfig
      onClose={() => {
        import('@utils/model').then(({ reloadModelManager }) => {
          reloadModelManager()
          triggerModelConfigChange()
          onDone()
        })
      }}
    />
  )
}
