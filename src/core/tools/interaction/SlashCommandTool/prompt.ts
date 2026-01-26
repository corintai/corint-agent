import {
  loadCustomCommands,
  type CustomCommandWithScope,
} from '@services/customCommands'

export const TOOL_NAME_FOR_PROMPT = 'SlashCommand'
export const DESCRIPTION = `- Executes predefined project commands stored in .claude/.kode/commands/*.md
- Input: command string (e.g., "/test" or "/deploy staging")
- Only executes known commands; otherwise returns an error`

function getCharBudget(): number {
  const raw = Number(process.env.SLASH_COMMAND_TOOL_CHAR_BUDGET)
  return Number.isFinite(raw) && raw > 0 ? raw : 15000
}

export async function getSlashCommandPrompt(): Promise<string> {
  const all = await loadCustomCommands()
  const commands = all.filter(
    cmd =>
      cmd.type === 'prompt' &&
      cmd.isSkill !== true &&
      cmd.disableModelInvocation !== true &&
      (cmd.hasUserSpecifiedDescription || cmd.whenToUse),
  )

  const limited: CustomCommandWithScope[] = []
  let used = 0
  for (const cmd of commands) {
    const name = `/${cmd.name}`
    const args = cmd.argumentHint ? ` ${cmd.argumentHint}` : ''
    const whenToUse = cmd.whenToUse ? `- ${cmd.whenToUse}` : ''
    const line = `- ${name}${args}: ${cmd.description} ${whenToUse}`.trim()
    used += line.length + 1
    if (used > getCharBudget()) break
    limited.push(cmd)
  }

  const availableLines =
    limited.length > 0
      ? limited
          .map(cmd => {
            const name = `/${cmd.name}`
            const args = cmd.argumentHint ? ` ${cmd.argumentHint}` : ''
            const whenToUse = cmd.whenToUse ? `- ${cmd.whenToUse}` : ''
            return `- ${name}${args}: ${cmd.description} ${whenToUse}`.trim()
          })
          .join('\n')
      : ''

  const truncatedNotice =
    commands.length > limited.length
      ? `\n(Showing ${limited.length} of ${commands.length} commands due to token limits)`
      : ''

  return `Execute a slash command within the main conversation

How slash commands work:
When you use this tool or when a user types a slash command, you will see <command-message>{name} is running...</command-message> followed by the expanded prompt. For example, if .claude/commands/foo.md contains "Print today's date", then /foo expands to that prompt in the next message.

Usage:
- \`command\` (required): The slash command to execute, including any arguments
- Example: \`command: "/review-pr 123"\`

IMPORTANT: Only use this tool for custom slash commands that appear in the Available Commands list below. Do NOT use for:
- Built-in CLI commands (like /help, /clear, etc.)
- Commands not shown in the list
- Commands you think might exist but aren't listed

${
  availableLines
    ? `Available Commands:
${availableLines}${truncatedNotice}
`
    : ''
}Notes:
- When a user requests multiple slash commands, execute each one sequentially and check for <command-message>{name} is running...</command-message> to verify each has been processed
- Do not invoke a command that is already running. For example, if you see <command-message>foo is running...</command-message>, do NOT use this tool with "/foo" - process the expanded prompt in the following message
- Only custom slash commands with descriptions are listed in Available Commands. If a user's command is not listed, ask them to check the slash command file and consult the docs.
`
}
