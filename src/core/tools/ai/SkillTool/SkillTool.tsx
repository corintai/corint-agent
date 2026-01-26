import { z } from 'zod'
import { Tool } from '@tool'
import type { Message } from '@query'
import { createUserMessage } from '@utils/messages'
import { getCommands } from '@commands'
import { TOOL_NAME_FOR_PROMPT, getSkillToolPrompt } from './prompt'

const inputSchema = z.strictObject({
  skill: z
    .string()
    .describe(
      'The skill name (no arguments). Use a value from <available_skills>.',
    ),
  args: z
    .string()
    .optional()
    .describe('Optional arguments for the skill (freeform text)'),
})

type Input = z.infer<typeof inputSchema>
type Output = {
  success: boolean
  commandName: string
  allowedTools?: string[]
  model?: string
}

function normalizeCommandModelName(model: unknown): string | undefined {
  if (typeof model !== 'string') return undefined
  const trimmed = model.trim()
  if (!trimmed || trimmed === 'inherit') return undefined
  if (trimmed === 'haiku') return 'quick'
  if (trimmed === 'sonnet') return 'task'
  if (trimmed === 'opus') return 'main'
  return trimmed
}

export const SkillTool = {
  name: TOOL_NAME_FOR_PROMPT,
  async description({ skill }: Input) {
    return `Execute skill: ${skill}`
  },
  userFacingName() {
    return 'Skill'
  },
  inputSchema,
  isReadOnly() {
    return false
  },
  isConcurrencySafe() {
    return false
  },
  async isEnabled() {
    return true
  },
  needsPermissions() {
    return true
  },
  async prompt() {
    return getSkillToolPrompt()
  },
  renderToolUseMessage({ skill }: Input, _options: { verbose: boolean }) {
    return skill || ''
  },
  renderResultForAssistant(output: Output) {
    return `Launching skill: ${output.commandName}`
  },
  async validateInput({ skill }: Input, context) {
    const raw = skill.trim()
    if (!raw) {
      return {
        result: false,
        message: `Invalid skill format: ${skill}`,
        errorCode: 1,
      }
    }
    const skillName = raw.startsWith('/') ? raw.slice(1) : raw

    const commands = context?.options?.commands ?? (await getCommands())
    const cmd = findCommand(skillName, commands)
    if (!cmd) {
      return {
        result: false,
        message: `Unknown skill: ${skillName}. No matching skill is available in <available_skills>.`,
        errorCode: 2,
      }
    }

    if ((cmd as any).disableModelInvocation) {
      return {
        result: false,
        message: `Skill ${skillName} cannot be used with ${TOOL_NAME_FOR_PROMPT} tool due to disable-model-invocation`,
        errorCode: 4,
      }
    }

    if (cmd.type !== 'prompt') {
      return {
        result: false,
        message: `Skill ${skillName} is not a prompt-based skill`,
        errorCode: 5,
      }
    }

    return { result: true }
  },
  async *call({ skill, args }: Input, context) {
    const raw = skill.trim()
    const skillName = raw.startsWith('/') ? raw.slice(1) : raw

    const commands = context.options?.commands ?? (await getCommands())
    const cmd = findCommand(skillName, commands)
    if (!cmd) {
      throw new Error(`Unknown skill: ${skillName}`)
    }
    if ((cmd as any).disableModelInvocation) {
      throw new Error(
        `Skill ${skillName} cannot be used with ${TOOL_NAME_FOR_PROMPT} tool due to disable-model-invocation`,
      )
    }
    if (cmd.type !== 'prompt') {
      throw new Error(`Skill ${skillName} is not a prompt-based skill`)
    }

    const prompt = await cmd.getPromptForCommand(args ?? '')
    const expandedMessages: Message[] = prompt.map(msg => {
      const userMessage = createUserMessage(
        typeof msg.content === 'string'
          ? msg.content
          : msg.content
              .map(block => (block.type === 'text' ? block.text : ''))
              .join('\n'),
      )
      userMessage.options = {
        ...userMessage.options,
        isCustomCommand: true,
        commandName: cmd.userFacingName(),
        commandArgs: '',
      }
      return userMessage
    })

    const allowedTools: string[] = Array.isArray((cmd as any).allowedTools)
      ? (cmd as any).allowedTools
      : []
    const model = normalizeCommandModelName((cmd as any).model)
    const maxThinkingTokens: number | undefined =
      typeof (cmd as any).maxThinkingTokens === 'number'
        ? (cmd as any).maxThinkingTokens
        : undefined

    const output: Output = {
      success: true,
      commandName: skillName,
      allowedTools: allowedTools.length > 0 ? allowedTools : undefined,
      model,
    }

    yield {
      type: 'result' as const,
      data: output,
      resultForAssistant: this.renderResultForAssistant(output),
      newMessages: expandedMessages,
      contextModifier:
        allowedTools.length > 0 || model || maxThinkingTokens !== undefined
          ? {
              modifyContext(ctx) {
                const next = { ...ctx }

                if (allowedTools.length > 0) {
                  const prev = Array.isArray(
                    (next.options as any)?.commandAllowedTools,
                  )
                    ? ((next.options as any).commandAllowedTools as string[])
                    : []
                  next.options = {
                    ...(next.options || {}),
                    commandAllowedTools: [
                      ...new Set([...prev, ...allowedTools]),
                    ],
                  }
                }

                if (model) {
                  next.options = { ...(next.options || {}), model }
                }

                if (maxThinkingTokens !== undefined) {
                  next.options = {
                    ...(next.options || {}),
                    maxThinkingTokens,
                  }
                }

                return next
              },
            }
          : undefined,
    }
  },
} satisfies Tool<typeof inputSchema, Output>

function findCommand(commandName: string, commands: any[]): any | null {
  return (
    commands.find(
      (c: any) =>
        c?.name === commandName ||
        c?.userFacingName?.() === commandName ||
        (Array.isArray(c?.aliases) && c.aliases.includes(commandName)),
    ) ?? null
  )
}
