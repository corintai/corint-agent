import React, { useMemo, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import figures from 'figures'

import { Select, type OptionSubtree } from '@components/custom-select/select'
import type { AgentConfig } from '@utils/agent/loader'
import { getModelManager } from '@utils/model'
import type { Tool } from '../tooling'

import { Panel, Instructions } from './shared'
import { DEFAULT_AGENT_MODEL, COLOR_OPTIONS, AgentColor } from './constants'
import {
  formatModelLong,
  getToolNameFromSpec,
  parseMcpToolName,
  themeColor,
} from './helpers'
import type { WizardContextValue, WizardFinalAgent } from './types'
import { getPrimaryAgentFilePath } from '../storage'
import { validateAgentConfig, validateAgentType } from '../generation'

function modelOptions(): (OptionSubtree | { label: string; value: string })[] {
  const profiles = (() => {
    try {
      return getModelManager().getActiveModelProfiles() as Array<{
        name: string
        modelName: string
        provider?: string
      }>
    } catch {
      return []
    }
  })()

  const base: Array<{ label: string; value: string }> = [
    { value: 'sonnet', label: 'Task (alias: sonnet)' },
    { value: 'opus', label: 'Main (alias: opus)' },
    { value: 'haiku', label: 'Quick (alias: haiku)' },
    { value: 'inherit', label: 'Inherit from parent' },
  ]

  const extras: Array<{ label: string; value: string }> = []
  for (const profile of profiles) {
    if (!profile?.name) continue
    const value = profile.name
    if (base.some(o => o.value === value)) continue
    extras.push({
      value,
      label:
        profile.provider && profile.modelName
          ? `${profile.name} (${profile.provider}:${profile.modelName})`
          : profile.name,
    })
  }

  if (extras.length === 0) return base

  return [
    { header: 'Compatibility aliases', options: base },
    {
      header: 'Model profiles',
      options: extras.sort((a, b) => a.label.localeCompare(b.label)),
    },
  ]
}

export function ToolPicker(props: {
  tools: Tool[]
  initialTools: string[] | undefined
  onComplete: (tools: string[] | undefined) => void
  onCancel: () => void
}) {
  const normalizedTools = useMemo(() => {
    const unique = new Map<string, Tool>()
    for (const tool of props.tools) {
      if (!tool?.name) continue
      unique.set(tool.name, tool)
    }
    return Array.from(unique.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    )
  }, [props.tools])

  const allToolNames = useMemo(
    () => normalizedTools.map(t => t.name),
    [normalizedTools],
  )

  const initialSelectedNames = useMemo(() => {
    if (!props.initialTools) return allToolNames
    if (props.initialTools.includes('*')) return allToolNames
    const available = new Set(allToolNames)
    return props.initialTools.filter(t => available.has(t))
  }, [props.initialTools, allToolNames])

  const [selected, setSelected] = useState<string[]>(initialSelectedNames)
  const [cursorIndex, setCursorIndex] = useState(0)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const selectedSet = useMemo(() => new Set(selected), [selected])
  const isAllSelected =
    selected.length === allToolNames.length && allToolNames.length > 0

  const toggleOne = (name: string) => {
    setSelected(prev =>
      prev.includes(name) ? prev.filter(x => x !== name) : [...prev, name],
    )
  }

  const toggleMany = (names: string[], enable: boolean) => {
    setSelected(prev => {
      if (enable) {
        const missing = names.filter(n => !prev.includes(n))
        return [...prev, ...missing]
      }
      return prev.filter(n => !names.includes(n))
    })
  }

  const complete = () => {
    const next =
      selected.length === allToolNames.length &&
      allToolNames.every(n => selected.includes(n))
        ? undefined
        : selected
    props.onComplete(next)
  }

  const categorized = useMemo(() => {
    const readOnly = new Set(['Read', 'Glob', 'Grep', 'LS'])
    const edit = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
    const execution = new Set(['Bash', 'BashOutput', 'KillBash'])

    const buckets: Record<
      'readOnly' | 'edit' | 'execution' | 'mcp' | 'other',
      string[]
    > = { readOnly: [], edit: [], execution: [], mcp: [], other: [] }

    for (const tool of normalizedTools) {
      const name = tool.name
      if (name.startsWith('mcp__')) buckets.mcp.push(name)
      else if (readOnly.has(name)) buckets.readOnly.push(name)
      else if (edit.has(name)) buckets.edit.push(name)
      else if (execution.has(name)) buckets.execution.push(name)
      else buckets.other.push(name)
    }

    return buckets
  }, [normalizedTools])

  const mcpServers = useMemo(() => {
    const byServer = new Map<string, string[]>()
    for (const name of categorized.mcp) {
      const parsed = parseMcpToolName(name)
      if (!parsed) continue
      const list = byServer.get(parsed.serverName) ?? []
      list.push(name)
      byServer.set(parsed.serverName, list)
    }
    return Array.from(byServer.entries())
      .map(([serverName, toolNames]) => ({ serverName, toolNames }))
      .sort((a, b) => a.serverName.localeCompare(b.serverName))
  }, [categorized.mcp])

  type Item = {
    id: string
    label: string
    isHeader?: boolean
    isToggle?: boolean
    action: () => void
  }

  const items: Item[] = useMemo(() => {
    const out: Item[] = []

    out.push({ id: 'continue', label: '[ Continue ]', action: complete })
    out.push({
      id: 'bucket-all',
      label: `${isAllSelected ? figures.checkboxOn : figures.checkboxOff} All tools`,
      action: () => toggleMany(allToolNames, !isAllSelected),
    })

    const bucketDefs: Array<{
      id: string
      label: string
      names: string[]
    }> = [
      {
        id: 'bucket-readonly',
        label: 'Read-only tools',
        names: categorized.readOnly,
      },
      { id: 'bucket-edit', label: 'Edit tools', names: categorized.edit },
      {
        id: 'bucket-execution',
        label: 'Execution tools',
        names: categorized.execution,
      },
      { id: 'bucket-mcp', label: 'MCP tools', names: categorized.mcp },
      { id: 'bucket-other', label: 'Other tools', names: categorized.other },
    ]

    for (const bucket of bucketDefs) {
      if (bucket.names.length === 0) continue
      const allInBucket = bucket.names.every(n => selectedSet.has(n))
      out.push({
        id: bucket.id,
        label: `${allInBucket ? figures.checkboxOn : figures.checkboxOff} ${bucket.label}`,
        action: () => toggleMany(bucket.names, !allInBucket),
      })
    }

    out.push({
      id: 'toggle-advanced',
      label: showAdvanced ? 'Hide advanced options' : 'Show advanced options',
      isToggle: true,
      action: () => setShowAdvanced(prev => !prev),
    })

    if (!showAdvanced) return out

    if (mcpServers.length > 0) {
      out.push({
        id: 'mcp-servers-header',
        label: 'MCP Servers:',
        isHeader: true,
        action: () => {},
      })
      for (const server of mcpServers) {
        const allServer = server.toolNames.every(n => selectedSet.has(n))
        out.push({
          id: `mcp-server-${server.serverName}`,
          label: `${allServer ? figures.checkboxOn : figures.checkboxOff} ${server.serverName} (${server.toolNames.length} tool${server.toolNames.length === 1 ? '' : 's'})`,
          action: () => toggleMany(server.toolNames, !allServer),
        })
      }
    }

    out.push({
      id: 'tools-header',
      label: 'Individual Tools:',
      isHeader: true,
      action: () => {},
    })
    for (const name of allToolNames) {
      let labelName = name
      const parsed = parseMcpToolName(name)
      if (parsed) labelName = `${parsed.toolName} (${parsed.serverName})`
      out.push({
        id: `tool-${name}`,
        label: `${selectedSet.has(name) ? figures.checkboxOn : figures.checkboxOff} ${labelName}`,
        action: () => toggleOne(name),
      })
    }

    return out
  }, [
    allToolNames,
    categorized,
    complete,
    isAllSelected,
    mcpServers,
    selectedSet,
    showAdvanced,
  ])

  useInput((_input, key) => {
    if (key.escape) {
      props.onCancel()
      return
    }

    if (key.return) {
      const item = items[cursorIndex]
      if (item && !item.isHeader) item.action()
      return
    }

    if (key.upArrow) {
      let next = cursorIndex - 1
      while (next > 0 && items[next]?.isHeader) next--
      setCursorIndex(Math.max(0, next))
      return
    }

    if (key.downArrow) {
      let next = cursorIndex + 1
      while (next < items.length - 1 && items[next]?.isHeader) next++
      setCursorIndex(Math.min(items.length - 1, next))
      return
    }
  })

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text
        color={cursorIndex === 0 ? themeColor('suggestion') : undefined}
        bold={cursorIndex === 0}
      >
        {cursorIndex === 0 ? `${figures.pointer} ` : '  '}[ Continue ]
      </Text>
      <Text dimColor>{'─'.repeat(40)}</Text>
      {items.slice(1).map((item, idx) => {
        const index = idx + 1
        const focused = index === cursorIndex
        const prefix = item.isHeader
          ? ''
          : focused
            ? `${figures.pointer} `
            : '  '
        return (
          <React.Fragment key={item.id}>
            {item.isToggle ? <Text dimColor>{'─'.repeat(40)}</Text> : null}
            <Text
              dimColor={item.isHeader}
              color={
                !item.isHeader && focused ? themeColor('suggestion') : undefined
              }
              bold={item.isToggle && focused}
            >
              {item.isToggle
                ? `${prefix}[ ${item.label} ]`
                : `${prefix}${item.label}`}
            </Text>
          </React.Fragment>
        )
      })}
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>
          {isAllSelected
            ? 'All tools selected'
            : `${selectedSet.size} of ${allToolNames.length} tools selected`}
        </Text>
      </Box>
    </Box>
  )
}

export function StepSelectTools(props: {
  ctx: WizardContextValue
  tools: Tool[]
}) {
  const { ctx } = props
  const initialTools = ctx.wizardData.selectedTools
  return (
    <>
      <Panel title="Create new agent" subtitle="Select tools">
        <ToolPicker
          tools={props.tools}
          initialTools={initialTools}
          onComplete={selected => {
            ctx.updateWizardData({ selectedTools: selected })
            ctx.goNext()
          }}
          onCancel={ctx.goBack}
        />
      </Panel>
      <Instructions instructions="Press Enter to toggle selection · ↑↓ Navigate · Esc to go back" />
    </>
  )
}

export function StepSelectModel({ ctx }: { ctx: WizardContextValue }) {
  useInput((_input, key) => {
    if (key.escape) ctx.goBack()
  })

  const options = modelOptions()
  const defaultValue = ctx.wizardData.selectedModel ?? DEFAULT_AGENT_MODEL

  return (
    <WizardPanel
      subtitle="Select model"
      footerText="Press ↑↓ to navigate · Enter to select · Esc to go back"
    >
      <Box flexDirection="column" marginTop={1} gap={1}>
        <Text dimColor>
          Model determines the agent&apos;s reasoning capabilities and speed.
        </Text>
        <Select
          options={options as any}
          defaultValue={defaultValue}
          onChange={value => {
            ctx.updateWizardData({ selectedModel: value })
            ctx.goNext()
          }}
        />
      </Box>
    </WizardPanel>
  )
}

function WizardPanel(props: {
  subtitle: string
  footerText?: string
  children?: React.ReactNode
}) {
  return (
    <>
      <Panel title="Create new agent" subtitle={props.subtitle}>
        {props.children}
      </Panel>
      <Instructions instructions={props.footerText} />
    </>
  )
}

export function ColorPicker(props: {
  agentName: string
  currentColor: AgentColor
  onConfirm: (color: AgentColor) => void
}) {
  const [index, setIndex] = useState(
    Math.max(
      0,
      COLOR_OPTIONS.findIndex(c => c === props.currentColor),
    ),
  )

  useInput((_input, key) => {
    if (key.upArrow) setIndex(i => (i > 0 ? i - 1 : COLOR_OPTIONS.length - 1))
    else if (key.downArrow)
      setIndex(i => (i < COLOR_OPTIONS.length - 1 ? i + 1 : 0))
    else if (key.return) props.onConfirm(COLOR_OPTIONS[index] ?? 'automatic')
  })

  return (
    <Box flexDirection="column" gap={1}>
      {COLOR_OPTIONS.map((color, i) => {
        const focused = i === index
        const prefix = focused ? figures.pointer : ' '
        const label =
          color === 'automatic'
            ? 'Automatic color'
            : color.charAt(0).toUpperCase() + color.slice(1)
        return (
          <React.Fragment key={color}>
            <Text
              color={focused ? themeColor('suggestion') : undefined}
              bold={focused}
            >
              {prefix} {label}
            </Text>
          </React.Fragment>
        )
      })}
    </Box>
  )
}

export function StepChooseColor({ ctx }: { ctx: WizardContextValue }) {
  useInput((_input, key) => {
    if (key.escape) ctx.goBack()
  })

  const agentType = ctx.wizardData.agentType ?? 'agent'
  const onConfirm = (color: AgentColor) => {
    const selectedColor = color === 'automatic' ? undefined : color
    const finalAgent: WizardFinalAgent = {
      agentType: ctx.wizardData.agentType ?? agentType,
      whenToUse: ctx.wizardData.whenToUse ?? '',
      systemPrompt: ctx.wizardData.systemPrompt ?? '',
      tools: ctx.wizardData.selectedTools,
      model: ctx.wizardData.selectedModel ?? DEFAULT_AGENT_MODEL,
      ...(selectedColor ? { color: selectedColor } : {}),
      source: ctx.wizardData.location ?? 'projectSettings',
    }

    ctx.updateWizardData({
      selectedColor: selectedColor,
      finalAgent,
    })
    ctx.goNext()
  }

  return (
    <WizardPanel
      subtitle="Choose background color"
      footerText="Press ↑↓ to navigate · Enter to select · Esc to go back"
    >
      <Box marginTop={1}>
        <ColorPicker
          agentName={agentType}
          currentColor="automatic"
          onConfirm={onConfirm}
        />
      </Box>
    </WizardPanel>
  )
}

function validateFinalAgent(args: {
  finalAgent: WizardFinalAgent
  tools: Tool[]
  existingAgents: AgentConfig[]
}): { errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []

  const typeValidation = validateAgentType(
    args.finalAgent.agentType,
    args.existingAgents,
  )
  errors.push(...typeValidation.errors)
  warnings.push(...typeValidation.warnings)

  const configValidation = validateAgentConfig({
    agentType: args.finalAgent.agentType,
    whenToUse: args.finalAgent.whenToUse,
    systemPrompt: args.finalAgent.systemPrompt,
    selectedTools: args.finalAgent.tools ?? ['*'],
  })
  errors.push(...configValidation.errors)
  warnings.push(...configValidation.warnings)

  const availableToolNames = new Set(args.tools.map(t => t.name))
  const selectedTools = args.finalAgent.tools ?? undefined
  if (selectedTools && selectedTools.length > 0) {
    const unknown = selectedTools.filter(t => !availableToolNames.has(t))
    if (unknown.length > 0)
      warnings.push(`Unrecognized tools: ${unknown.join(', ')}`)
  }

  return { errors, warnings }
}

export function StepConfirm(props: {
  ctx: WizardContextValue
  tools: Tool[]
  existingAgents: AgentConfig[]
  onSave: (finalAgent: WizardFinalAgent, openEditor: boolean) => Promise<void>
}) {
  const { ctx } = props
  const finalAgent = ctx.wizardData.finalAgent
  const [error, setError] = useState<string | null>(null)

  useInput((input, key) => {
    if (key.escape) ctx.goBack()
    else if (input === 'e') void doSave(true)
    else if (input === 's' || key.return) void doSave(false)
  })

  const toolSummary = (tools: string[] | undefined): string => {
    if (tools === undefined) return 'All tools'
    if (tools.length === 0) return 'None'
    if (tools.length === 1) return tools[0] || 'None'
    if (tools.length === 2) return tools.join(' and ')
    return `${tools.slice(0, -1).join(', ')}, and ${tools[tools.length - 1]}`
  }

  const doSave = async (openEditor: boolean) => {
    if (!finalAgent) return
    const { errors } = validateFinalAgent({
      finalAgent,
      tools: props.tools,
      existingAgents: props.existingAgents,
    })
    if (errors.length > 0) {
      setError(errors[0] ?? 'Invalid agent configuration')
      return
    }
    try {
      await props.onSave(finalAgent, openEditor)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (!finalAgent) return null

  const validation = validateFinalAgent({
    finalAgent,
    tools: props.tools,
    existingAgents: props.existingAgents,
  })

  const locationPath =
    finalAgent.source === 'projectSettings'
      ? getPrimaryAgentFilePath('project', finalAgent.agentType)
      : getPrimaryAgentFilePath('user', finalAgent.agentType)

  const truncate = (text: string) =>
    text.length > 240 ? `${text.slice(0, 240)}…` : text

  return (
    <WizardPanel
      subtitle="Confirm and save"
      footerText="Press s/Enter to save · e to edit in your editor · Esc to cancel"
    >
      <Box flexDirection="column" marginTop={1} gap={1}>
        <Text>
          <Text bold>Name</Text>: {finalAgent.agentType}
        </Text>
        <Text>
          <Text bold>Location</Text>: {locationPath}
        </Text>
        <Text>
          <Text bold>Tools</Text>: {toolSummary(finalAgent.tools)}
        </Text>
        <Text>
          <Text bold>Model</Text>: {formatModelLong(finalAgent.model)}
        </Text>

        <Box marginTop={1} flexDirection="column">
          <Text>
            <Text bold>Description</Text> (tells Claude when to use this agent):
          </Text>
          <Box marginLeft={2} marginTop={1}>
            <Text>{truncate(finalAgent.whenToUse)}</Text>
          </Box>
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text>
            <Text bold>System prompt</Text>:
          </Text>
          <Box marginLeft={2} marginTop={1}>
            <Text>{truncate(finalAgent.systemPrompt)}</Text>
          </Box>
        </Box>

        {validation.warnings.length > 0 ? (
          <Box marginTop={1} flexDirection="column">
            <Text color={themeColor('warning')}>Warnings:</Text>
            {validation.warnings.map((w, i) => (
              <React.Fragment key={i}>
                <Text dimColor> • {w}</Text>
              </React.Fragment>
            ))}
          </Box>
        ) : null}

        {validation.errors.length > 0 ? (
          <Box marginTop={1} flexDirection="column">
            <Text color={themeColor('error')}>Errors:</Text>
            {validation.errors.map((e, i) => (
              <React.Fragment key={i}>
                <Text color={themeColor('error')}> • {e}</Text>
              </React.Fragment>
            ))}
          </Box>
        ) : null}

        {error ? (
          <Box marginTop={1}>
            <Text color={themeColor('error')}>{error}</Text>
          </Box>
        ) : null}
      </Box>
    </WizardPanel>
  )
}
