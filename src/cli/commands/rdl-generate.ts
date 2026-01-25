import { Command } from '@commands'
import { AskUserQuestionTool } from '@tools/interaction/AskUserQuestionTool/AskUserQuestionTool'
import { TaskTool } from '@tools/agent/TaskTool/TaskTool'

export default {
  type: 'prompt',
  name: 'rdl-generate',
  description:
    'Generate an RDL rule, ruleset, pipeline, feature, or list from requirements',
  argumentHint: '<type> <name> [requirements]',
  isEnabled: true,
  isHidden: false,
  progressMessage: 'generating RDL',
  userFacingName() {
    return 'rdl-generate'
  },
  async getPromptForCommand(args) {
    return [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `
You are generating RDL artifacts in the CORINT repository. The user invoked /rdl-generate.

Args (if provided): ${args}

Process:
1. Parse args as: <type> <name> [requirements].
   - type must be one of: rule, ruleset, pipeline, feature, list.
   - name should be a file-safe identifier.
2. If type or name or requirements are missing or ambiguous, ask clarifying questions using ${AskUserQuestionTool.name}.
   - Ask for rule category when type=rule (default: custom).
   - Ask whether to reuse existing rules/rulesets if dependencies are needed.
3. Read relevant DSL docs from knowledge/rdl and examples/templates in repository/library to align with existing patterns.
   - Do NOT read from any corint-decision path; use workspace-relative paths only.
4. You MUST launch ${TaskTool.name} with subagent_type "rdl-generator" and a detailed prompt including:
   - requested type, name, category (if rule), requirements, and constraints
   - target path conventions from repository
   - instruction to create new files only (no overwrites)
   - instruction to write only under repository/ (never .corint or other hidden dirs)
   - instruction to verify the file exists after writing
   - instruction to use .yaml extension and avoid Bash for mkdir or writes
5. The final response MUST only summarize generated file paths and key logic from the subagent output.

Constraints:
- Do not modify existing files unless the user explicitly asks.
- Do not update repository/registry.yaml unless the user explicitly asks.
- Follow RDL syntax and repository conventions.
`,
          },
        ],
      },
    ]
  },
} satisfies Command
