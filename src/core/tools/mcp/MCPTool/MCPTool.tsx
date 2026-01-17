import { z } from 'zod'
import { type Tool } from '@tool'
import { DESCRIPTION, PROMPT } from './prompt'

const inputSchema = z.object({}).passthrough()

export const MCPTool = {
  async isEnabled() {
    return true
  },
  isReadOnly() {
    return false
  },
  isConcurrencySafe() {
    return false
  },
  name: 'mcp',
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return PROMPT
  },
  inputSchema,
  async *call() {
    yield {
      type: 'result',
      data: '',
      resultForAssistant: '',
    }
  },
  needsPermissions() {
    return true
  },
  renderToolUseMessage(input) {
    return Object.entries(input)
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
      .join(', ')
  },
  userFacingName: () => 'mcp',
  renderResultForAssistant(content) {
    return content
  },
} satisfies Tool<typeof inputSchema, string>
