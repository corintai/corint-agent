import React, { useMemo } from 'react'
import chalk from 'chalk'

import type { AgentConfig } from '@utils/agent/loader'
import type { Tool } from '../tooling'

import { Wizard } from './wizardBase'
import {
  StepChooseLocation,
  StepChooseMethod,
  StepGenerationPrompt,
  StepAgentType,
  StepSystemPrompt,
  StepDescription,
} from './wizardBase'
import {
  StepSelectTools,
  StepSelectModel,
  StepChooseColor,
  StepConfirm,
} from './wizardPickers'
import { wizardLocationToStorageLocation, openInEditor } from './helpers'
import type { WizardContextValue } from './types'
import { saveAgent, getPrimaryAgentFilePath } from '../storage'

export function CreateAgentWizard(props: {
  tools: Tool[]
  existingAgents: AgentConfig[]
  onComplete: (message: string) => void
  onCancel: () => void
}) {
  const steps = useMemo(() => {
    return [
      (ctx: WizardContextValue) => <StepChooseLocation ctx={ctx} />,
      (ctx: WizardContextValue) => <StepChooseMethod ctx={ctx} />,
      (ctx: WizardContextValue) => (
        <StepGenerationPrompt ctx={ctx} existingAgents={props.existingAgents} />
      ),
      (ctx: WizardContextValue) => (
        <StepAgentType ctx={ctx} existingAgents={props.existingAgents} />
      ),
      (ctx: WizardContextValue) => <StepSystemPrompt ctx={ctx} />,
      (ctx: WizardContextValue) => <StepDescription ctx={ctx} />,
      (ctx: WizardContextValue) => (
        <StepSelectTools ctx={ctx} tools={props.tools} />
      ),
      (ctx: WizardContextValue) => <StepSelectModel ctx={ctx} />,
      (ctx: WizardContextValue) => <StepChooseColor ctx={ctx} />,
      (ctx: WizardContextValue) => (
        <StepConfirm
          ctx={ctx}
          tools={props.tools}
          existingAgents={props.existingAgents}
          onSave={async (finalAgent, openEditor) => {
            const location = wizardLocationToStorageLocation(finalAgent.source)
            const tools = finalAgent.tools ?? ['*']
            await saveAgent(
              location,
              finalAgent.agentType,
              finalAgent.whenToUse,
              tools,
              finalAgent.systemPrompt,
              finalAgent.model,
              finalAgent.color,
              true,
            )

            if (openEditor) {
              const path = getPrimaryAgentFilePath(
                location,
                finalAgent.agentType,
              )
              await openInEditor(path)
              props.onComplete(
                `Created agent: ${chalk.bold(finalAgent.agentType)} and opened in editor. If you made edits, restart to load the latest version.`,
              )
              return
            }

            props.onComplete(`Created agent: ${chalk.bold(finalAgent.agentType)}`)
          }}
        />
      ),
    ]
  }, [props])

  return <Wizard steps={steps} onCancel={props.onCancel} onDone={() => {}} />
}
