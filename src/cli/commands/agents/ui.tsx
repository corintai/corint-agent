import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import figures from 'figures'
import chalk from 'chalk'
import { join } from 'path'

import TextInput from '@components/TextInput'
import { Select } from '@components/custom-select/select'
import { getTheme } from '@utils/theme'
import {
  clearAgentCache,
  getActiveAgents,
  getAllAgents,
  type AgentConfig,
} from '@utils/agent/loader'
import { getAvailableTools, type Tool } from './tooling'
import { deleteAgent, updateAgent } from './storage'

import { AgentsListView } from './ui/AgentsListView'
import { CreateAgentWizard } from './ui/wizard'
import { Panel, Instructions } from './ui/shared'
import {
  formatModelLong,
  getToolNameFromSpec,
  panelBorderColor,
  themeColor,
  toSelectableToolNames,
} from './ui/helpers'
import type {
  AgentSourceFilter,
  AgentWithOverride,
  ModeState,
} from './ui/types'

function computeOverrides(args: {
  allAgents: AgentConfig[]
  activeAgents: AgentConfig[]
}): AgentWithOverride[] {
  const activeByType = new Map<string, AgentConfig>()
  for (const agent of args.activeAgents)
    activeByType.set(agent.agentType, agent)
  return args.allAgents.map(agent => {
    const active = activeByType.get(agent.agentType)
    const overriddenBy =
      active && active.source !== agent.source ? active.source : undefined
    return { ...agent, ...(overriddenBy ? { overriddenBy } : {}) }
  })
}

function AgentMenu(props: {
  agent: AgentWithOverride
  onChoose: (value: 'view' | 'edit' | 'delete' | 'back') => void
  onCancel: () => void
}) {
  useInput((_input, key) => {
    if (key.escape) props.onCancel()
  })

  const isBuiltIn = props.agent.source === 'built-in'
  const options = [
    { label: 'View agent', value: 'view' },
    ...(isBuiltIn
      ? []
      : [
          { label: 'Edit agent', value: 'edit' },
          { label: 'Delete agent', value: 'delete' },
        ]),
    { label: 'Back', value: 'back' },
  ]

  return (
    <>
      <Panel title={props.agent.agentType}>
        <Box flexDirection="column" marginTop={1}>
          <Select
            options={options}
            onChange={value => props.onChoose(value as any)}
          />
        </Box>
      </Panel>
      <Instructions />
    </>
  )
}

function ViewAgent(props: {
  agent: AgentWithOverride
  tools: Tool[]
  onBack: () => void
}) {
  useInput((_input, key) => {
    if (key.escape || key.return) props.onBack()
  })

  const toolNames = new Set(props.tools.map(t => t.name))
  const parsedTools = (() => {
    const toolSpec = props.agent.tools
    if (toolSpec === '*')
      return { hasWildcard: true, valid: [], invalid: [] as string[] }
    if (!toolSpec || toolSpec.length === 0)
      return { hasWildcard: false, valid: [], invalid: [] as string[] }
    const names = toolSpec.map(getToolNameFromSpec).filter(Boolean)
    const valid: string[] = []
    const invalid: string[] = []
    for (const name of names) {
      if (
        name.includes('*') &&
        Array.from(toolNames).some(t => t.startsWith(name.replace(/\*+$/, '')))
      ) {
        valid.push(name)
        continue
      }
      if (toolNames.has(name)) valid.push(name)
      else invalid.push(name)
    }
    return { hasWildcard: false, valid, invalid }
  })()

  const sourceLine = (() => {
    if (props.agent.source === 'built-in') return 'Built-in'
    if (props.agent.source === 'plugin')
      return `Plugin: ${props.agent.baseDir ?? 'Unknown'}`
    const baseDir = props.agent.baseDir
    const file = `${props.agent.filename ?? props.agent.agentType}.md`
    if (props.agent.source === 'projectSettings')
      return join('.claude', 'agents', file)
    if (baseDir) return join(baseDir, file)
    return props.agent.source
  })()

  const toolsSummary = () => {
    if (parsedTools.hasWildcard) return 'All tools'
    if (
      !props.agent.tools ||
      props.agent.tools === '*' ||
      props.agent.tools.length === 0
    )
      return 'None'
    return (
      <>
        {parsedTools.valid.length > 0 ? parsedTools.valid.join(', ') : null}
        {parsedTools.invalid.length > 0 ? (
          <>
            <Text color={themeColor('warning')}>
              {' '}
              (Unknown: {parsedTools.invalid.join(', ')})
            </Text>
          </>
        ) : null}
      </>
    )
  }

  return (
    <>
      <Panel title={props.agent.agentType}>
        <Box flexDirection="column" marginTop={1} gap={1}>
          <Text>
            <Text bold>Source</Text>: {sourceLine}
          </Text>
          <Text>
            <Text bold>Model</Text>: {formatModelLong(props.agent.model)}
          </Text>
          <Text>
            <Text bold>Tools</Text>: {toolsSummary()}
          </Text>
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Description:</Text>
            <Text dimColor>{props.agent.whenToUse}</Text>
          </Box>
          <Box flexDirection="column" marginTop={1}>
            <Text bold>System Prompt:</Text>
            <Text dimColor>{props.agent.systemPrompt}</Text>
          </Box>
        </Box>
      </Panel>
      <Instructions instructions="Press Enter or Esc to go back" />
    </>
  )
}

function EditAgent(props: {
  agent: AgentWithOverride
  tools: Tool[]
  onBack: () => void
  onSaved: (message: string) => void
}) {
  const [workingAgent, setWorkingAgent] = useState<AgentWithOverride>(
    props.agent,
  )
  const [isSaving, setIsSaving] = useState(false)
  const [whenToUseCursorOffset, setWhenToUseCursorOffset] = useState(
    props.agent.whenToUse.length,
  )
  const [systemPromptCursorOffset, setSystemPromptCursorOffset] = useState(
    props.agent.systemPrompt.length,
  )

  useInput((_input, key) => {
    if (key.escape) props.onBack()
  })

  const onSave = async () => {
    if (isSaving) return
    setIsSaving(true)
    try {
      await updateAgent(
        workingAgent,
        workingAgent.whenToUse,
        workingAgent.tools,
        workingAgent.systemPrompt,
        workingAgent.color,
        workingAgent.model,
      )
      props.onSaved(`Updated agent: ${chalk.bold(workingAgent.agentType)}`)
    } finally {
      setIsSaving(false)
    }
  }

  const onDelete = async () => {
    await deleteAgent(workingAgent)
    props.onSaved(`Deleted agent: ${chalk.bold(workingAgent.agentType)}`)
  }

  const onFieldUpdate = (field: keyof AgentConfig, value: any) => {
    setWorkingAgent(prev => ({ ...prev, [field]: value }))
  }

  return (
    <>
      <Panel title={`Edit ${workingAgent.agentType}`}>
        <Box flexDirection="column" marginTop={1} gap={1}>
          <Box flexDirection="column" marginBottom={1}>
            <Text bold>Description (when to use)</Text>
            <TextInput
              value={workingAgent.whenToUse}
              onChange={value => onFieldUpdate('whenToUse', value)}
              multiline
              columns={80}
              cursorOffset={whenToUseCursorOffset}
              onChangeCursorOffset={setWhenToUseCursorOffset}
            />
          </Box>
          <Box flexDirection="column" marginBottom={1}>
            <Text bold>System prompt</Text>
            <TextInput
              value={workingAgent.systemPrompt}
              onChange={value => onFieldUpdate('systemPrompt', value)}
              multiline
              columns={80}
              cursorOffset={systemPromptCursorOffset}
              onChangeCursorOffset={setSystemPromptCursorOffset}
            />
          </Box>
          <Box flexDirection="column" marginBottom={1}>
            <Text bold>Tools</Text>
            <Text dimColor>
              {toSelectableToolNames(workingAgent.tools)?.join(', ') ??
                'All tools'}
            </Text>
          </Box>
          <Box flexDirection="column" marginBottom={1}>
            <Text bold>Model</Text>
            <Text dimColor>{formatModelLong(workingAgent.model)}</Text>
          </Box>
          <Box flexDirection="row" gap={2}>
            <Select
              options={[
                { label: 'Save changes', value: 'save' },
                { label: 'Delete agent', value: 'delete' },
                { label: 'Cancel', value: 'cancel' },
              ]}
              onChange={value => {
                if (value === 'save') void onSave()
                else if (value === 'delete') void onDelete()
                else props.onBack()
              }}
            />
          </Box>
          {isSaving ? <Text dimColor>Saving...</Text> : null}
        </Box>
      </Panel>
      <Instructions instructions="Press ↑↓ to navigate · Enter to select · Esc to cancel" />
    </>
  )
}

function DeleteConfirm(props: {
  agent: AgentWithOverride
  onCancel: () => void
  onConfirm: () => void
}) {
  const theme = getTheme()
  useInput((_input, key) => {
    if (key.escape) props.onCancel()
  })

  return (
    <>
      <Panel
        title="Delete agent"
        borderColor={panelBorderColor('error')}
        titleColor={themeColor('error')}
      >
        <Box flexDirection="column" gap={1}>
          <Text>
            Are you sure you want to delete the agent{' '}
            <Text bold>{props.agent.agentType}</Text>?
          </Text>
          <Box marginTop={1}>
            <Text dimColor>Source: {props.agent.source}</Text>
          </Box>
          <Box marginTop={1}>
            <Select
              options={[
                { label: 'Yes, delete', value: 'yes' },
                { label: 'No, cancel', value: 'no' },
              ]}
              onChange={value => {
                if (value === 'yes') props.onConfirm()
                else props.onCancel()
              }}
            />
          </Box>
        </Box>
      </Panel>
      <Instructions instructions="Press ↑↓ to navigate, Enter to select, Esc to cancel" />
    </>
  )
}

export function AgentsUI({ onExit }: { onExit: (message?: string) => void }) {
  const [mode, setMode] = useState<ModeState>({
    mode: 'list-agents',
    source: 'all',
  })
  const [loading, setLoading] = useState(true)
  const [allAgents, setAllAgents] = useState<AgentConfig[]>([])
  const [activeAgents, setActiveAgents] = useState<AgentConfig[]>([])
  const [tools, setTools] = useState<Tool[]>([])
  const [changes, setChanges] = useState<string[]>([])

  const refresh = useCallback(async () => {
    clearAgentCache()
    const [all, active] = await Promise.all([getAllAgents(), getActiveAgents()])
    setAllAgents(all)
    setActiveAgents(active)
  }, [])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const [toolList] = await Promise.all([getAvailableTools(), refresh()])
        if (!mounted) return
        setTools(toolList)
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [refresh])

  const agentsWithOverride = useMemo(() => {
    return computeOverrides({ allAgents, activeAgents })
  }, [allAgents, activeAgents])

  const listAgentsForSource = useMemo(() => {
    const bySource: Record<AgentSourceFilter, AgentWithOverride[]> = {
      all: agentsWithOverride,
      'built-in': agentsWithOverride.filter(a => a.source === 'built-in'),
      userSettings: agentsWithOverride.filter(a => a.source === 'userSettings'),
      projectSettings: agentsWithOverride.filter(
        a => a.source === 'projectSettings',
      ),
      policySettings: agentsWithOverride.filter(
        a => a.source === 'policySettings',
      ),
      flagSettings: agentsWithOverride.filter(a => a.source === 'flagSettings'),
      plugin: agentsWithOverride.filter(a => a.source === 'plugin'),
    }

    if (mode.mode === 'list-agents') return bySource[mode.source]
    if (mode.source === 'all') return bySource.all
    if (mode.source === 'built-in') return bySource['built-in']
    if (mode.source === 'userSettings') return bySource.userSettings
    if (mode.source === 'projectSettings') return bySource.projectSettings
    if (mode.source === 'policySettings') return bySource.policySettings
    if (mode.source === 'flagSettings') return bySource.flagSettings
    if (mode.source === 'plugin') return bySource.plugin
    return []
  }, [agentsWithOverride, mode])

  const dismiss = useCallback(() => {
    if (changes.length > 0) {
      onExit(`Agent changes:\n${changes.join('\n')}`)
      return
    }
    onExit('Agents dialog dismissed')
  }, [changes, onExit])

  if (loading) {
    return (
      <>
        <Panel title="Agents" subtitle="Loading…">
          <Text dimColor>Loading agents…</Text>
        </Panel>
        <Instructions />
      </>
    )
  }

  if (mode.mode === 'list-agents') {
    return (
      <AgentsListView
        source={mode.source}
        agents={listAgentsForSource}
        changes={changes}
        onCreateNew={() =>
          setMode({ mode: 'create-agent', previousMode: mode })
        }
        onSelect={agent =>
          setMode({ mode: 'agent-menu', agent, previousMode: mode })
        }
        onBack={dismiss}
      />
    )
  }

  if (mode.mode === 'create-agent') {
    return (
      <CreateAgentWizard
        tools={tools}
        existingAgents={activeAgents}
        onCancel={() => setMode(mode.previousMode)}
        onComplete={async message => {
          setChanges(prev => [...prev, message])
          await refresh()
          setMode({ mode: 'list-agents', source: 'all' })
        }}
      />
    )
  }

  if (mode.mode === 'agent-menu') {
    return (
      <AgentMenu
        agent={mode.agent}
        onCancel={() => setMode(mode.previousMode)}
        onChoose={value => {
          if (value === 'back') setMode(mode.previousMode)
          else if (value === 'view')
            setMode({
              mode: 'view-agent',
              agent: mode.agent,
              previousMode: mode,
            })
          else if (value === 'edit')
            setMode({
              mode: 'edit-agent',
              agent: mode.agent,
              previousMode: mode,
            })
          else if (value === 'delete')
            setMode({
              mode: 'delete-confirm',
              agent: mode.agent,
              previousMode: mode,
            })
        }}
      />
    )
  }

  if (mode.mode === 'view-agent') {
    return (
      <ViewAgent
        agent={mode.agent}
        tools={tools}
        onBack={() => setMode(mode.previousMode)}
      />
    )
  }

  if (mode.mode === 'edit-agent') {
    return (
      <EditAgent
        agent={mode.agent}
        tools={tools}
        onBack={() => setMode(mode.previousMode)}
        onSaved={async message => {
          setChanges(prev => [...prev, message])
          await refresh()
          setMode(mode.previousMode)
        }}
      />
    )
  }

  if (mode.mode === 'delete-confirm') {
    return (
      <DeleteConfirm
        agent={mode.agent}
        onCancel={() => setMode(mode.previousMode)}
        onConfirm={async () => {
          await deleteAgent(mode.agent)
          setChanges(prev => [
            ...prev,
            `Deleted agent: ${chalk.bold(mode.agent.agentType)}`,
          ])
          await refresh()
          setMode({ mode: 'list-agents', source: 'all' })
        }}
      />
    )
  }

  return null
}
