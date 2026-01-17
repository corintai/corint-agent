import React, { useCallback, useMemo, useRef, useState } from 'react'
import { Box, Text, useInput } from 'ink'

import TextInput from '@components/TextInput'
import { Select } from '@components/custom-select/select'
import type { AgentConfig } from '@utils/agent/loader'

import { generateAgentWithClaude, validateAgentType } from '../generation'
import { Panel, Instructions } from './shared'
import { themeColor } from './helpers'
import type { WizardContextValue, WizardData, WizardMethod } from './types'

export function Wizard(props: {
  steps: Array<(ctx: WizardContextValue) => React.ReactNode>
  initialData?: WizardData
  onCancel: () => void
  onDone: (data: WizardData) => void
}) {
  const [stepIndex, setStepIndex] = useState(0)
  const [data, setData] = useState<WizardData>(props.initialData ?? {})
  const [history, setHistory] = useState<number[]>([])

  const goNext = useCallback(() => {
    setHistory(prev => [...prev, stepIndex])
    setStepIndex(prev => Math.min(prev + 1, props.steps.length - 1))
  }, [props.steps.length, stepIndex])

  const goBack = useCallback(() => {
    setHistory(prev => {
      if (prev.length === 0) {
        props.onCancel()
        return prev
      }
      const next = [...prev]
      const last = next.pop()
      if (typeof last === 'number') setStepIndex(last)
      return next
    })
  }, [props.onCancel])

  const goToStep = useCallback(
    (index: number) => {
      setHistory(prev => [...prev, stepIndex])
      setStepIndex(() => Math.max(0, Math.min(index, props.steps.length - 1)))
    },
    [props.steps.length, stepIndex],
  )

  const updateWizardData = useCallback((patch: Partial<WizardData>) => {
    setData(prev => ({ ...prev, ...patch }))
  }, [])

  const cancel = useCallback(() => props.onCancel(), [props.onCancel])
  const done = useCallback(() => props.onDone(data), [props, data])

  const ctx: WizardContextValue = useMemo(
    () => ({
      stepIndex,
      totalSteps: props.steps.length,
      wizardData: data,
      updateWizardData,
      goNext,
      goBack,
      goToStep,
      cancel,
      done,
    }),
    [
      data,
      done,
      goBack,
      goNext,
      goToStep,
      props.steps.length,
      stepIndex,
      updateWizardData,
      cancel,
    ],
  )

  return <>{props.steps[stepIndex]?.(ctx) ?? null}</>
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

export function StepChooseLocation({ ctx }: { ctx: WizardContextValue }) {
  useInput((_input, key) => {
    if (key.escape) ctx.cancel()
  })

  return (
    <WizardPanel
      subtitle="Choose location"
      footerText="Press ↑↓ to navigate · Enter to select · Esc to cancel"
    >
      <Box marginTop={1}>
        <Select
          options={[
            { label: 'Project (.claude/agents/)', value: 'projectSettings' },
            { label: 'Personal (~/.claude/agents/)', value: 'userSettings' },
          ]}
          onChange={value => {
            const location =
              value === 'projectSettings' ? 'projectSettings' : 'userSettings'
            ctx.updateWizardData({ location })
            ctx.goNext()
          }}
        />
      </Box>
    </WizardPanel>
  )
}

export function StepChooseMethod({ ctx }: { ctx: WizardContextValue }) {
  useInput((_input, key) => {
    if (key.escape) ctx.goBack()
  })

  return (
    <WizardPanel subtitle="Creation method">
      <Box marginTop={1}>
        <Select
          options={[
            { label: 'Generate with Claude (recommended)', value: 'generate' },
            { label: 'Manual configuration', value: 'manual' },
          ]}
          onChange={value => {
            const method: WizardMethod =
              value === 'manual' ? 'manual' : 'generate'
            ctx.updateWizardData({
              method,
              wasGenerated: method === 'generate',
            })
            if (method === 'generate') ctx.goNext()
            else ctx.goToStep(3)
          }}
        />
      </Box>
    </WizardPanel>
  )
}

export function StepGenerationPrompt(props: {
  ctx: WizardContextValue
  existingAgents: AgentConfig[]
}) {
  const { ctx } = props
  const [value, setValue] = useState(ctx.wizardData.generationPrompt ?? '')
  const [cursorOffset, setCursorOffset] = useState(value.length)
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const columns = Math.min(80, process.stdout.columns ?? 80)

  useInput((_input, key) => {
    if (!key.escape) return
    if (isGenerating && abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
      setIsGenerating(false)
      setError('Generation cancelled')
      return
    }
    if (!isGenerating) {
      ctx.updateWizardData({
        generationPrompt: '',
        agentType: '',
        systemPrompt: '',
        whenToUse: '',
        wasGenerated: false,
      })
      setValue('')
      setCursorOffset(0)
      setError(null)
      ctx.goBack()
    }
  })

  const onSubmit = async () => {
    const trimmed = value.trim()
    if (!trimmed) {
      setError('Please describe what the agent should do')
      return
    }

    setError(null)
    setIsGenerating(true)
    ctx.updateWizardData({ generationPrompt: trimmed, isGenerating: true })

    const abort = new AbortController()
    abortRef.current = abort

    try {
      const existing = props.existingAgents.map(a => a.agentType)
      const generated = await generateAgentWithClaude(trimmed)
      if (existing.includes(generated.identifier)) {
        throw new Error(
          `Agent identifier already exists: ${generated.identifier}. Please try again.`,
        )
      }

      ctx.updateWizardData({
        agentType: generated.identifier,
        whenToUse: generated.whenToUse,
        systemPrompt: generated.systemPrompt,
        wasGenerated: true,
        isGenerating: false,
      })
      setIsGenerating(false)
      abortRef.current = null
      ctx.goToStep(6)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message || 'Failed to generate agent')
      setIsGenerating(false)
      ctx.updateWizardData({ isGenerating: false })
      abortRef.current = null
    }
  }

  return (
    <WizardPanel subtitle="Describe the agent you want">
      <Box flexDirection="column" marginTop={1} gap={1}>
        <Text>What should this agent do?</Text>
        <Text dimColor>
          Describe a role like “code reviewer”, “security auditor”, or “tech
          lead”.
        </Text>
        <TextInput
          value={value}
          onChange={setValue}
          columns={columns}
          multiline
          onSubmit={onSubmit}
          cursorOffset={cursorOffset}
          onChangeCursorOffset={setCursorOffset}
        />
        {error ? <Text color={themeColor('error')}>{error}</Text> : null}
        {isGenerating ? <Text dimColor>Generating…</Text> : null}
      </Box>
    </WizardPanel>
  )
}

export function StepAgentType(props: {
  ctx: WizardContextValue
  existingAgents: AgentConfig[]
}) {
  const { ctx } = props
  const [value, setValue] = useState(ctx.wizardData.agentType ?? '')
  const [cursorOffset, setCursorOffset] = useState(value.length)
  const [error, setError] = useState<string | null>(null)
  const columns = 60

  useInput((_input, key) => {
    if (key.escape) ctx.goBack()
  })

  const onSubmit = (next: string) => {
    const trimmed = next.trim()
    const validation = validateAgentType(trimmed, props.existingAgents)
    if (!validation.isValid) {
      setError(validation.errors[0] ?? 'Invalid agent type')
      return
    }
    setError(null)
    ctx.updateWizardData({ agentType: trimmed })
    ctx.goNext()
  }

  return (
    <WizardPanel
      subtitle="Agent type (identifier)"
      footerText="Press Enter to continue · Esc to go back"
    >
      <Box flexDirection="column" marginTop={1} gap={1}>
        <Text>Enter a unique identifier for your agent:</Text>
        <TextInput
          value={value}
          onChange={setValue}
          columns={columns}
          onSubmit={onSubmit}
          cursorOffset={cursorOffset}
          onChangeCursorOffset={setCursorOffset}
        />
        <Text dimColor>e.g., code-reviewer, tech-lead, etc</Text>
        {error ? <Text color={themeColor('error')}>{error}</Text> : null}
      </Box>
    </WizardPanel>
  )
}

export function StepSystemPrompt({ ctx }: { ctx: WizardContextValue }) {
  const [value, setValue] = useState(ctx.wizardData.systemPrompt ?? '')
  const [cursorOffset, setCursorOffset] = useState(value.length)
  const [error, setError] = useState<string | null>(null)
  const columns = Math.min(80, process.stdout.columns ?? 80)

  useInput((_input, key) => {
    if (key.escape) ctx.goBack()
  })

  const onSubmit = (next: string) => {
    const trimmed = next.trim()
    if (!trimmed) {
      setError('System prompt is required')
      return
    }
    setError(null)
    ctx.updateWizardData({ systemPrompt: trimmed })
    ctx.goNext()
  }

  return (
    <WizardPanel
      subtitle="System prompt"
      footerText="Press Enter to continue · Esc to go back"
    >
      <Box flexDirection="column" marginTop={1} gap={1}>
        <Text>Enter the system prompt for your agent:</Text>
        <Text dimColor>Be comprehensive for best results</Text>
        <TextInput
          value={value}
          onChange={setValue}
          columns={columns}
          multiline
          onSubmit={onSubmit}
          cursorOffset={cursorOffset}
          onChangeCursorOffset={setCursorOffset}
        />
        {error ? <Text color={themeColor('error')}>{error}</Text> : null}
      </Box>
    </WizardPanel>
  )
}

export function StepDescription({ ctx }: { ctx: WizardContextValue }) {
  const [value, setValue] = useState(ctx.wizardData.whenToUse ?? '')
  const [cursorOffset, setCursorOffset] = useState(value.length)
  const [error, setError] = useState<string | null>(null)
  const columns = Math.min(80, process.stdout.columns ?? 80)

  useInput((_input, key) => {
    if (key.escape) ctx.goBack()
  })

  const onSubmit = (next: string) => {
    const trimmed = next.trim()
    if (!trimmed) {
      setError('Description is required')
      return
    }
    setError(null)
    ctx.updateWizardData({ whenToUse: trimmed })
    ctx.goNext()
  }

  return (
    <WizardPanel
      subtitle="Description (tell Claude when to use this agent)"
      footerText="Press Enter to continue · Esc to go back"
    >
      <Box flexDirection="column" marginTop={1} gap={1}>
        <Text>When should Claude use this agent?</Text>
        <TextInput
          value={value}
          onChange={setValue}
          columns={columns}
          multiline
          onSubmit={onSubmit}
          cursorOffset={cursorOffset}
          onChangeCursorOffset={setCursorOffset}
        />
        {error ? <Text color={themeColor('error')}>{error}</Text> : null}
      </Box>
    </WizardPanel>
  )
}
