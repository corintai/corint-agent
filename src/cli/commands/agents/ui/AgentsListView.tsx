import React, { useEffect, useMemo, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import figures from 'figures'

import { Select } from '@components/custom-select/select'
import { getTheme } from '@utils/theme'

import { formatModelShort, titleForSource } from './helpers'
import { Panel, Instructions } from './shared'
import type { AgentSourceFilter, AgentWithOverride } from './types'

export function AgentsListView(props: {
  source: AgentSourceFilter
  agents: AgentWithOverride[]
  changes: string[]
  onCreateNew?: () => void
  onSelect: (agent: AgentWithOverride) => void
  onBack: () => void
}) {
  const theme = getTheme()

  const selectableAgents = useMemo(() => {
    const nonBuiltIn = props.agents.filter(a => a.source !== 'built-in')
    if (props.source === 'all') {
      return [
        ...nonBuiltIn.filter(a => a.source === 'userSettings'),
        ...nonBuiltIn.filter(a => a.source === 'projectSettings'),
        ...nonBuiltIn.filter(a => a.source === 'policySettings'),
      ]
    }
    return nonBuiltIn
  }, [props.agents, props.source])

  const [selectedAgent, setSelectedAgent] = useState<AgentWithOverride | null>(
    null,
  )
  const [onCreateOption, setOnCreateOption] = useState(true)

  useEffect(() => {
    if (props.onCreateNew) {
      setOnCreateOption(true)
      setSelectedAgent(null)
      return
    }
    if (!selectedAgent && selectableAgents.length > 0) {
      setSelectedAgent(selectableAgents[0] ?? null)
    }
  }, [props.onCreateNew, selectableAgents, selectedAgent])

  useInput((_input, key) => {
    if (key.escape) {
      props.onBack()
      return
    }

    if (key.return) {
      if (onCreateOption && props.onCreateNew) {
        props.onCreateNew()
        return
      }
      if (selectedAgent) props.onSelect(selectedAgent)
      return
    }

    if (!key.upArrow && !key.downArrow) return

    const hasCreate = Boolean(props.onCreateNew)
    const navigableCount = selectableAgents.length + (hasCreate ? 1 : 0)
    if (navigableCount === 0) return

    const currentIndex = (() => {
      if (hasCreate && onCreateOption) return 0
      if (!selectedAgent) return hasCreate ? 0 : 0
      const idx = selectableAgents.findIndex(
        a =>
          a.agentType === selectedAgent.agentType &&
          a.source === selectedAgent.source,
      )
      if (idx < 0) return hasCreate ? 0 : 0
      return hasCreate ? idx + 1 : idx
    })()

    const nextIndex = key.upArrow
      ? currentIndex === 0
        ? navigableCount - 1
        : currentIndex - 1
      : currentIndex === navigableCount - 1
        ? 0
        : currentIndex + 1

    if (hasCreate && nextIndex === 0) {
      setOnCreateOption(true)
      setSelectedAgent(null)
      return
    }

    const agentIndex = hasCreate ? nextIndex - 1 : nextIndex
    const nextAgent = selectableAgents[agentIndex]
    if (nextAgent) {
      setOnCreateOption(false)
      setSelectedAgent(nextAgent)
    }
  })

  const renderCreateNew = () => (
    <Box>
      <Text color={onCreateOption ? theme.suggestion : undefined}>
        {onCreateOption ? `${figures.pointer} ` : '  '}
      </Text>
      <Text color={onCreateOption ? theme.suggestion : undefined}>
        Create new agent
      </Text>
    </Box>
  )

  const renderAgentRow = (agent: AgentWithOverride) => {
    const isBuiltIn = agent.source === 'built-in'
    const isSelected =
      !isBuiltIn &&
      !onCreateOption &&
      selectedAgent?.agentType === agent.agentType &&
      selectedAgent?.source === agent.source

    const dimmed = Boolean(isBuiltIn || agent.overriddenBy)
    const rowColor = isSelected ? theme.suggestion : undefined
    const pointer = isBuiltIn ? '' : isSelected ? `${figures.pointer} ` : '  '

    return (
      <Box key={`${agent.agentType}-${agent.source}`} flexDirection="row">
        <Text dimColor={dimmed && !isSelected} color={rowColor}>
          {pointer}
        </Text>
        <Text dimColor={dimmed && !isSelected} color={rowColor}>
          {agent.agentType}
        </Text>
        <Text dimColor color={rowColor}>
          {' · '}
          {formatModelShort(agent.model)}
        </Text>
        {agent.overriddenBy ? (
          <Text
            dimColor={!isSelected}
            color={isSelected ? theme.warning : undefined}
          >
            {' '}
            {figures.warning} overridden by {agent.overriddenBy}
          </Text>
        ) : null}
      </Box>
    )
  }

  const group = (label: string, agents: AgentWithOverride[]) => {
    if (agents.length === 0) return null
    const baseDir = agents[0]?.baseDir
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Box paddingLeft={2}>
          <Text bold dimColor>
            {label}
          </Text>
          {baseDir ? <Text dimColor> ({baseDir})</Text> : null}
        </Box>
        {agents.map(renderAgentRow)}
      </Box>
    )
  }

  const builtInSection = (label = 'Built-in (always available):') => {
    const builtIn = props.agents.filter(a => a.source === 'built-in')
    if (builtIn.length === 0) return null
    return (
      <Box flexDirection="column" marginBottom={1} paddingLeft={2}>
        <Text bold dimColor>
          {label}
        </Text>
        {builtIn.map(renderAgentRow)}
      </Box>
    )
  }

  const notOverriddenCount = props.agents.filter(a => !a.overriddenBy).length
  const title = titleForSource(props.source)

  if (
    props.agents.length === 0 ||
    (props.source !== 'built-in' &&
      !props.agents.some(a => a.source !== 'built-in'))
  ) {
    return (
      <>
        <Panel title={title} subtitle="No agents found">
          {props.onCreateNew ? (
            <Box marginY={1}>{renderCreateNew()}</Box>
          ) : null}
          <Text dimColor>
            No agents found. Create specialized subagents that Claude can
            delegate to.
          </Text>
          <Text dimColor>
            Each subagent has its own context window, custom system prompt, and
            specific tools.
          </Text>
          <Text dimColor>
            Try creating: Code Reviewer, Code Simplifier, Security Reviewer,
            Tech Lead, or UX Reviewer.
          </Text>
          {props.source !== 'built-in' &&
          props.agents.some(a => a.source === 'built-in') ? (
            <>
              <Box marginTop={1}>
                <Text dimColor>{'─'.repeat(40)}</Text>
              </Box>
              {builtInSection()}
            </>
          ) : null}
        </Panel>
        <Instructions />
      </>
    )
  }

  return (
    <>
      <Panel title={title} subtitle={`${notOverriddenCount} agents`}>
        {props.changes.length > 0 ? (
          <Box marginTop={1}>
            <Text dimColor>{props.changes[props.changes.length - 1]}</Text>
          </Box>
        ) : null}

        <Box flexDirection="column" marginTop={1}>
          {props.onCreateNew ? (
            <Box marginBottom={1}>{renderCreateNew()}</Box>
          ) : null}

          {props.source === 'all' ? (
            <>
              {group(
                'User agents',
                props.agents.filter(a => a.source === 'userSettings'),
              )}
              {group(
                'Project agents',
                props.agents.filter(a => a.source === 'projectSettings'),
              )}
              {group(
                'Managed agents',
                props.agents.filter(a => a.source === 'policySettings'),
              )}
              {group(
                'Plugin agents',
                props.agents.filter(a => a.source === 'plugin'),
              )}
              {group(
                'CLI arg agents',
                props.agents.filter(a => a.source === 'flagSettings'),
              )}
              {builtInSection('Built-in agents (always available)')}
            </>
          ) : props.source === 'built-in' ? (
            <>
              <Text dimColor italic>
                Built-in agents are provided by default and cannot be modified.
              </Text>
              <Box marginTop={1} flexDirection="column">
                {props.agents.map(renderAgentRow)}
              </Box>
            </>
          ) : (
            <Box flexDirection="column">
              {props.agents
                .filter(a => a.source !== 'built-in')
                .map(renderAgentRow)}
            </Box>
          )}
        </Box>
      </Panel>
      <Instructions />
    </>
  )
}
