import { spawn } from 'child_process'

import { getTheme } from '@utils/theme'
import type { AgentSourceFilter, WizardLocation } from './types'
import { DEFAULT_AGENT_MODEL } from './constants'

export function openInEditor(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const platform = process.platform
    let command: string
    let args: string[]

    switch (platform) {
      case 'darwin':
        command = 'open'
        args = [filePath]
        break
      case 'win32':
        command = 'cmd'
        args = ['/c', 'start', '', filePath]
        break
      default:
        command = 'xdg-open'
        args = [filePath]
        break
    }

    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    child.unref()
    child.on('error', err => reject(err))
    child.on('exit', code =>
      code === 0 ? resolve() : reject(new Error(`Editor exited with ${code}`)),
    )
  })
}

export function titleForSource(source: AgentSourceFilter): string {
  switch (source) {
    case 'all':
      return 'Agents'
    case 'built-in':
      return 'Built-in agents'
    case 'plugin':
      return 'Plugin agents'
    case 'userSettings':
      return 'User agents'
    case 'projectSettings':
      return 'Project agents'
    case 'policySettings':
      return 'Managed agents'
    case 'flagSettings':
      return 'CLI arg agents'
    default:
      return 'Agents'
  }
}

export function formatModelShort(model: string | undefined): string {
  const value = model || DEFAULT_AGENT_MODEL
  return value === 'inherit' ? 'inherit' : value
}

export function formatModelLong(model: string | undefined): string {
  if (!model) return 'Sonnet (default)'
  if (model === 'inherit') return 'Inherit from parent'
  if (model === 'sonnet' || model === 'opus' || model === 'haiku') {
    return model.charAt(0).toUpperCase() + model.slice(1)
  }
  return model
}

export function getToolNameFromSpec(spec: string): string {
  const trimmed = spec.trim()
  if (!trimmed) return trimmed
  const match = trimmed.match(/^([^(]+)\(([^)]+)\)$/)
  if (!match) return trimmed
  const toolName = match[1]?.trim()
  return toolName || trimmed
}

export function parseMcpToolName(
  name: string,
): { serverName: string; toolName: string } | null {
  if (!name.startsWith('mcp__')) return null
  const parts = name.split('__')
  if (parts.length < 3) return null
  return {
    serverName: parts[1] || 'unknown',
    toolName: parts.slice(2).join('__'),
  }
}

export function toSelectableToolNames(
  toolSpecs: string[] | '*',
): string[] | undefined {
  if (toolSpecs === '*') return undefined
  const names = toolSpecs.map(getToolNameFromSpec).filter(Boolean)
  if (names.includes('*')) return undefined
  return names
}

export function panelBorderColor(kind: 'suggestion' | 'error'): string {
  const theme = getTheme()
  return kind === 'error' ? theme.error : theme.suggestion
}

export function themeColor(
  kind: 'error' | 'warning' | 'success' | 'suggestion',
): string {
  const theme = getTheme()
  switch (kind) {
    case 'error':
      return theme.error
    case 'warning':
      return theme.warning
    case 'success':
      return theme.success
    case 'suggestion':
    default:
      return theme.suggestion
  }
}

export function wizardLocationToStorageLocation(
  location: WizardLocation,
): 'project' | 'user' {
  return location === 'projectSettings' ? 'project' : 'user'
}
