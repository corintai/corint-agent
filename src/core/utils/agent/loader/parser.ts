import { basename } from 'path'
import { z } from 'zod'
import { debug as debugLogger } from '@utils/log/debugLogger'
import { readMarkdownFile } from './markdown'
import { qP, z2A } from './tooling'
import type {
  AgentConfig,
  AgentLocation,
  AgentModel,
  AgentPermissionMode,
  AgentSource,
} from './types'

export const VALID_PERMISSION_MODES = [
  'default',
  'acceptEdits',
  'plan',
  'bypassPermissions',
  'dontAsk',
  'delegate',
] as const

export function sourceToLocation(source: AgentSource): AgentLocation {
  switch (source) {
    case 'plugin':
      return 'plugin'
    case 'userSettings':
      return 'user'
    case 'projectSettings':
      return 'project'
    case 'built-in':
    case 'flagSettings':
    case 'policySettings':
    default:
      return 'built-in'
  }
}

export function parseAgentFromFile(options: {
  filePath: string
  baseDir: string
  source: Exclude<AgentSource, 'flagSettings' | 'built-in'>
}): AgentConfig | null {
  const parsed = readMarkdownFile(options.filePath)
  if (!parsed) return null

  try {
    const fm = parsed.frontmatter ?? {}
    let name: unknown = fm.name
    let description: unknown = fm.description

    if (
      !name ||
      typeof name !== 'string' ||
      !description ||
      typeof description !== 'string'
    ) {
      return null
    }

    const whenToUse = description.replace(/\\n/g, '\n')
    const filename = basename(options.filePath, '.md')

    const color = typeof fm.color === 'string' ? fm.color : undefined

    let modelRaw: unknown = fm.model
    if (typeof modelRaw !== 'string' && typeof fm.model_name === 'string') {
      modelRaw = fm.model_name
    }
    let model = typeof modelRaw === 'string' ? modelRaw.trim() : undefined
    if (model === '') model = undefined

    const forkContextValue: unknown = fm.forkContext
    if (
      forkContextValue !== undefined &&
      forkContextValue !== 'true' &&
      forkContextValue !== 'false'
    ) {
      debugLogger.warn('AGENT_LOADER_INVALID_FORK_CONTEXT', {
        filePath: options.filePath,
        forkContext: String(forkContextValue),
      })
    }
    const forkContext = forkContextValue === 'true'

    if (forkContext && model && model !== 'inherit') {
      debugLogger.warn('AGENT_LOADER_FORK_CONTEXT_MODEL_OVERRIDE', {
        filePath: options.filePath,
        model,
      })
      model = 'inherit'
    }

    const permissionModeValue: unknown = fm.permissionMode
    const permissionModeIsValid =
      typeof permissionModeValue === 'string' &&
      VALID_PERMISSION_MODES.includes(
        permissionModeValue as AgentPermissionMode,
      )
    if (
      typeof permissionModeValue === 'string' &&
      permissionModeValue &&
      !permissionModeIsValid
    ) {
      debugLogger.warn('AGENT_LOADER_INVALID_PERMISSION_MODE', {
        filePath: options.filePath,
        permissionMode: permissionModeValue,
        valid: VALID_PERMISSION_MODES,
      })
    }

    const toolsList = z2A(fm.tools)
    const tools: string[] | '*' =
      toolsList === undefined || toolsList.includes('*') ? '*' : toolsList

    const disallowedRaw =
      fm.disallowedTools ?? fm['disallowed-tools'] ?? fm['disallowed_tools']
    const disallowedTools =
      disallowedRaw !== undefined ? z2A(disallowedRaw) : undefined

    const skills = qP(fm.skills)
    const systemPrompt = parsed.content.trim()

    const agent: AgentConfig = {
      agentType: name,
      whenToUse,
      tools,
      ...(disallowedTools !== undefined ? { disallowedTools } : {}),
      ...(skills.length > 0 ? { skills } : { skills: [] }),
      systemPrompt,
      source: options.source,
      location: sourceToLocation(options.source),
      baseDir: options.baseDir,
      filename,
      ...(color ? { color } : {}),
      ...(model ? { model: model as AgentModel } : {}),
      ...(permissionModeIsValid
        ? { permissionMode: permissionModeValue as AgentPermissionMode }
        : {}),
      ...(forkContext ? { forkContext: true } : {}),
    }

    return agent
  } catch {
    return null
  }
}

const agentJsonSchema = z.object({
  description: z.string().min(1, 'Description cannot be empty'),
  tools: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()).optional(),
  prompt: z.string().min(1, 'Prompt cannot be empty'),
  model: z.string().optional(),
  permissionMode: z.enum(VALID_PERMISSION_MODES).optional(),
})

export const agentsJsonSchema = z.record(z.string(), agentJsonSchema)

export function parseAgentFromJson(
  agentType: string,
  value: unknown,
): AgentConfig | null {
  const parsed = agentJsonSchema.safeParse(value)
  if (!parsed.success) return null

  const toolsList = z2A(parsed.data.tools)
  const disallowedList =
    parsed.data.disallowedTools !== undefined
      ? z2A(parsed.data.disallowedTools)
      : undefined
  const model =
    typeof parsed.data.model === 'string' ? parsed.data.model.trim() : undefined

  return {
    agentType,
    whenToUse: parsed.data.description,
    tools: toolsList === undefined || toolsList.includes('*') ? '*' : toolsList,
    ...(disallowedList !== undefined
      ? { disallowedTools: disallowedList }
      : {}),
    systemPrompt: parsed.data.prompt,
    source: 'flagSettings',
    location: 'built-in',
    ...(model ? { model: model as AgentModel } : {}),
    ...(parsed.data.permissionMode
      ? { permissionMode: parsed.data.permissionMode }
      : {}),
  }
}
