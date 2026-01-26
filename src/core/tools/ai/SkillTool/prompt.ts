import {
  loadCustomCommands,
  type CustomCommandWithScope,
} from '@services/customCommands'

export const TOOL_NAME_FOR_PROMPT = 'Skill'
export const DESCRIPTION = `- Executes predefined skills by name
- Input: skill string
- Fails if the skill is not available`

function formatSkillBlock(skill: CustomCommandWithScope): string {
  const name = skill.userFacingName?.() ?? skill.name
  const description = skill.whenToUse
    ? `${skill.description} - ${skill.whenToUse}`
    : skill.description

  const location = skill.filePath ?? ''

  return `<skill>
<name>
${name}
</name>
<description>
${description}
</description>
<location>
${location}
</location>
</skill>`
}

export async function getSkillToolPrompt(): Promise<string> {
  const all = await loadCustomCommands()
  const skills = all.filter(
    cmd =>
      cmd.type === 'prompt' &&
      cmd.disableModelInvocation !== true &&
      (cmd.hasUserSpecifiedDescription || cmd.whenToUse),
  )

  const budget = Number(process.env.SLASH_COMMAND_TOOL_CHAR_BUDGET) || 15000
  const limited: CustomCommandWithScope[] = []
  let used = 0
  for (const skill of skills) {
    const block = formatSkillBlock(skill)
    used += block.length + 1
    if (used > budget) break
    limited.push(skill)
  }

  const availableSkills = limited.map(formatSkillBlock).join('\n')
  const truncatedNotice =
    skills.length > limited.length
      ? `\n<!-- Showing ${limited.length} of ${skills.length} skills due to token limits -->`
      : ''

  return `Execute a skill within the main conversation

<skills_instructions>
When users ask you to perform tasks, check if any of the available skills below can help complete the task more effectively. Skills provide specialized capabilities and domain knowledge.

When users ask you to run a "slash command" or reference "/<something>" (e.g., "/commit", "/review-pr"), they are referring to a skill. Use this tool to invoke the corresponding skill.

<example>
User: "run /commit"
Assistant: [Calls Skill tool with skill: "commit"]
</example>

How to invoke:
- Use this tool with the skill name and optional arguments
- Examples:
  - \`skill: "pdf"\` - invoke the pdf skill
  - \`skill: "commit", args: "-m 'Fix bug'"\` - invoke with arguments
  - \`skill: "review-pr", args: "123"\` - invoke with arguments
  - \`skill: "ms-office-suite:pdf"\` - invoke using fully qualified name

Important:
- When a skill is relevant, you must invoke this tool IMMEDIATELY as your first action
- NEVER just announce or mention a skill in your text response without actually calling this tool
- This is a BLOCKING REQUIREMENT: invoke the relevant Skill tool BEFORE generating any other response about the task
- Only use skills listed in <available_skills> below
- Do not invoke a skill that is already running
- Do not use this tool for built-in CLI commands (like /help, /clear, etc.)
</skills_instructions>

<available_skills>
${availableSkills}${truncatedNotice}
</available_skills>
`
}
