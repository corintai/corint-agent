import { existsSync, watch, type FSWatcher } from 'fs'
import { join } from 'path'
import { memoize } from 'lodash-es'
import { getCwd } from '@utils/state'
import { getSessionPlugins } from '@utils/session/sessionPlugins'
import { isSettingSourceEnabled } from '@utils/config/settingSources'
import { debug as debugLogger } from '@utils/log/debugLogger'
import { logError } from '@utils/log'
import {
  findProjectAgentDirs,
  getClaudePolicyBaseDir,
  getUserConfigRoots,
} from './loader/paths'
import { agentsJsonSchema, parseAgentFromJson } from './loader/parser'
import { mergeAgents, scanAgentPaths } from './loader/scanner'

import type {
  AgentConfig,
  AgentSource,
} from './loader/types'

export type {
  AgentConfig,
  AgentLocation,
  AgentModel,
  AgentPermissionMode,
  AgentSource,
} from './loader/types'

let FLAG_AGENTS: AgentConfig[] = []

export function setFlagAgentsFromCliJson(json: string | undefined): void {
  if (!json) {
    FLAG_AGENTS = []
    clearAgentCache()
    return
  }

  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch (err) {
    logError(err)
    debugLogger.warn('AGENT_LOADER_FLAG_AGENTS_JSON_PARSE_FAILED', {
      error: err instanceof Error ? err.message : String(err),
    })
    FLAG_AGENTS = []
    clearAgentCache()
    return
  }

  const parsed = agentsJsonSchema.safeParse(raw)
  if (!parsed.success) {
    logError(parsed.error)
    debugLogger.warn('AGENT_LOADER_FLAG_AGENTS_SCHEMA_INVALID', {
      error: parsed.error.message,
    })
    FLAG_AGENTS = []
    clearAgentCache()
    return
  }

  FLAG_AGENTS = Object.entries(parsed.data)
    .map(([agentType, value]) => parseAgentFromJson(agentType, value))
    .filter((agent): agent is AgentConfig => agent !== null)

  clearAgentCache()
}

const BUILTIN_GENERAL_PURPOSE: AgentConfig = {
  agentType: 'general-purpose',
  whenToUse:
    'General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks',
  tools: '*',
  systemPrompt: `You are a general-purpose agent. Given the user's task, use the tools available to complete it efficiently and thoroughly.

When to use your capabilities:
- Searching for code, configurations, and patterns across large codebases
- Analyzing multiple files to understand system architecture  
- Investigating complex questions that require exploring many files
- Performing multi-step research tasks

Guidelines:
- For file searches: Use Grep or Glob when you need to search broadly. Use FileRead when you know the specific file path.
- For analysis: Start broad and narrow down. Use multiple search strategies if the first doesn't yield results.
- Be thorough: Check multiple locations, consider different naming conventions, look for related files.
- Complete tasks directly using your capabilities.`,
  source: 'built-in',
  location: 'built-in',
  baseDir: 'built-in',
}

const BUILTIN_EXPLORE: AgentConfig = {
  agentType: 'Explore',
  whenToUse:
    'Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.',
  tools: '*',
  disallowedTools: ['Task', 'ExitPlanMode', 'Edit', 'Write', 'NotebookEdit'],
  model: 'haiku',
  systemPrompt: `You are a file search specialist. You excel at thoroughly navigating and exploring codebases.

=== CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS ===
This is a READ-ONLY exploration task. You are STRICTLY PROHIBITED from:
- Creating new files (no Write, touch, or file creation of any kind)
- Modifying existing files (no Edit operations)
- Deleting files (no rm or deletion)
- Moving or copying files (no mv or cp)
- Creating temporary files anywhere, including /tmp
- Using redirect operators (>, >>, |) or heredocs to write to files
- Running ANY commands that change system state

Your role is EXCLUSIVELY to search and analyze existing code. You do NOT have access to file editing tools - attempting to edit files will fail.

Your strengths:
- Rapidly finding files using glob patterns
- Searching code and text with powerful regex patterns
- Reading and analyzing file contents

Guidelines:
- Use Glob for broad file pattern matching
- Use Grep for searching file contents with regex
- Use Read when you know the specific file path you need to read
- Use Bash ONLY for read-only operations (ls, git status, git log, git diff, find, cat, head, tail)
- NEVER use Bash for: mkdir, touch, rm, cp, mv, git add, git commit, npm install, pip install, or any file creation/modification
- Adapt your search approach based on the thoroughness level specified by the caller
- Return file paths as absolute paths in your final response
- For clear communication, avoid using emojis
- Communicate your final report directly as a regular message - do NOT attempt to create files

NOTE: You are meant to be a fast agent that returns output as quickly as possible. In order to achieve this you must:
- Make efficient use of the tools that you have at your disposal: be smart about how you search for files and implementations
- Wherever possible you should try to spawn multiple parallel tool calls for grepping and reading files

Complete the user's search request efficiently and report your findings clearly.`,
  source: 'built-in',
  location: 'built-in',
  baseDir: 'built-in',
}

const BUILTIN_PLAN: AgentConfig = {
  agentType: 'Plan',
  whenToUse:
    'Software architect agent for designing implementation plans. Use this when you need to plan the implementation strategy for a task. Returns step-by-step plans, identifies critical files, and considers architectural trade-offs.',
  tools: '*',
  disallowedTools: ['Task', 'ExitPlanMode', 'Edit', 'Write', 'NotebookEdit'],
  model: 'inherit',
  systemPrompt: `You are a software architect and planning specialist. Your role is to explore the codebase and design implementation plans.

=== CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS ===
This is a READ-ONLY planning task. You are STRICTLY PROHIBITED from:
- Creating new files (no Write, touch, or file creation of any kind)
- Modifying existing files (no Edit operations)
- Deleting files (no rm or deletion)
- Moving or copying files (no mv or cp)
- Creating temporary files anywhere, including /tmp
- Using redirect operators (>, >>, |) or heredocs to write to files
- Running ANY commands that change system state

Your role is EXCLUSIVELY to explore the codebase and design implementation plans. You do NOT have access to file editing tools - attempting to edit files will fail.

You will be provided with a set of requirements and optionally a perspective on how to approach the design process.

## Your Process

1. **Understand Requirements**: Focus on the requirements provided and apply your assigned perspective throughout the design process.

2. **Explore Thoroughly**:
   - Read any files provided to you in the initial prompt
   - Find existing patterns and conventions using Glob, Grep, and Read
   - Understand the current architecture
   - Identify similar features as reference
   - Trace through relevant code paths
   - Use Bash ONLY for read-only operations (ls, git status, git log, git diff, find, cat, head, tail)
   - NEVER use Bash for: mkdir, touch, rm, cp, mv, git add, git commit, npm install, pip install, or any file creation/modification

3. **Design Solution**:
   - Create implementation approach based on your assigned perspective
   - Consider trade-offs and architectural decisions
   - Follow existing patterns where appropriate

4. **Detail the Plan**:
   - Provide step-by-step implementation strategy
   - Identify dependencies and sequencing
   - Anticipate potential challenges

## Required Output

End your response with:

### Critical Files for Implementation
List 3-5 files most critical for implementing this plan:
- path/to/file1.ts - [Brief reason: e.g., "Core logic to modify"]
- path/to/file2.ts - [Brief reason: e.g., "Interfaces to implement"]
- path/to/file3.ts - [Brief reason: e.g., "Pattern to follow"]

REMEMBER: You can ONLY explore and plan. You CANNOT and MUST NOT write, edit, or modify any files. You do NOT have access to file editing tools.`,
  source: 'built-in',
  location: 'built-in',
  baseDir: 'built-in',
}

const BUILTIN_STATUSLINE_SETUP: AgentConfig = {
  agentType: 'statusline-setup',
  whenToUse:
    'Set up the CLI status line command (writes to ~/.corint/settings.json statusLine). Use when the user runs /statusline.',
  tools: ['Read', 'Edit', 'Bash'],
  systemPrompt: `You are the status line setup agent.

Your job is to configure a fast, single-line status command for the CLI UI.

Requirements:
- Write/update the user's ~/.corint/settings.json and set the top-level key "statusLine" to a shell command string.
- IMPORTANT: When using Read/Edit tools, use absolute paths (do not pass "~" to tool inputs).
- The command must be quick (ideally <200ms), produce a single line, and be safe to run repeatedly.
- Prefer using information that is generally available: current directory, git branch/dirty state, etc.
- If you can't infer the user's preferred status info from their shell config, ask them what they want and propose a reasonable default.

Suggested approach:
1) Inspect common shell config files (Read):
   - macOS/Linux: ~/.zshrc, ~/.bashrc, ~/.config/fish/config.fish
   - Windows: consider PowerShell profile if the user provides its location
2) Propose a statusLine command:
   - macOS/Linux: e.g. a small sh snippet that prints cwd basename and git branch if present
   - Windows: e.g. a short PowerShell one-liner that prints similar info
3) Update ~/.corint/settings.json:
   - If the file does not exist, create it as a minimal JSON object.
   - Preserve unrelated fields if present.
4) Reply with the exact command you set and how the user can change/remove it later.`,
  source: 'built-in',
  location: 'built-in',
  baseDir: 'built-in',
}

async function loadAllAgents(): Promise<{
  activeAgents: AgentConfig[]
  allAgents: AgentConfig[]
}> {
  const builtinAgents: AgentConfig[] = [
    BUILTIN_GENERAL_PURPOSE,
    BUILTIN_STATUSLINE_SETUP,
    BUILTIN_EXPLORE,
    BUILTIN_PLAN,
  ]

  const seenInodes = new Map<string, AgentSource>()

  const sessionPlugins = getSessionPlugins()
  const pluginAgentDirs = sessionPlugins.flatMap(p => p.agentsDirs ?? [])
  const pluginAgents = pluginAgentDirs.flatMap(dir =>
    scanAgentPaths({
      dirPathOrFile: dir,
      baseDir: dir,
      source: 'plugin',
      seenInodes,
    }),
  )

  const policyAgentsDir = join(getClaudePolicyBaseDir(), '.claude', 'agents')
  const policyAgents = scanAgentPaths({
    dirPathOrFile: policyAgentsDir,
    baseDir: policyAgentsDir,
    source: 'policySettings',
    seenInodes,
  })

  const userAgents: AgentConfig[] = []
  if (isSettingSourceEnabled('userSettings')) {
    for (const root of getUserConfigRoots()) {
      const dir = join(root, 'agents')
      userAgents.push(
        ...scanAgentPaths({
          dirPathOrFile: dir,
          baseDir: dir,
          source: 'userSettings',
          seenInodes,
        }),
      )
    }
  }

  const projectAgents: AgentConfig[] = []
  if (isSettingSourceEnabled('projectSettings')) {
    const dirs = findProjectAgentDirs(getCwd())
    for (const dir of dirs) {
      projectAgents.push(
        ...scanAgentPaths({
          dirPathOrFile: dir,
          baseDir: dir,
          source: 'projectSettings',
          seenInodes,
        }),
      )
    }
  }

  const allAgents: AgentConfig[] = [
    ...builtinAgents,
    ...pluginAgents,
    ...userAgents,
    ...projectAgents,
    ...FLAG_AGENTS,
    ...policyAgents,
  ]

  const activeAgents = mergeAgents(allAgents)
  return { activeAgents, allAgents }
}

export const getActiveAgents = memoize(async (): Promise<AgentConfig[]> => {
  const { activeAgents } = await loadAllAgents()
  return activeAgents
})

export const getAllAgents = memoize(async (): Promise<AgentConfig[]> => {
  const { allAgents } = await loadAllAgents()
  return allAgents
})

export const getAgentByType = memoize(
  async (agentType: string): Promise<AgentConfig | undefined> => {
    const agents = await getActiveAgents()
    return agents.find(agent => agent.agentType === agentType)
  },
)

export const getAvailableAgentTypes = memoize(async (): Promise<string[]> => {
  const agents = await getActiveAgents()
  return agents.map(agent => agent.agentType)
})

export function clearAgentCache(): void {
  getActiveAgents.cache?.clear?.()
  getAllAgents.cache?.clear?.()
  getAgentByType.cache?.clear?.()
  getAvailableAgentTypes.cache?.clear?.()
}

let watchers: FSWatcher[] = []

export async function startAgentWatcher(onChange?: () => void): Promise<void> {
  await stopAgentWatcher()

  const watchDirs: string[] = []

  watchDirs.push(join(getClaudePolicyBaseDir(), '.claude', 'agents'))

  if (isSettingSourceEnabled('userSettings')) {
    for (const root of getUserConfigRoots()) {
      watchDirs.push(join(root, 'agents'))
    }
  }

  if (isSettingSourceEnabled('projectSettings')) {
    watchDirs.push(...findProjectAgentDirs(getCwd()))
  }

  for (const plugin of getSessionPlugins()) {
    for (const dir of plugin.agentsDirs ?? []) {
      watchDirs.push(dir)
    }
  }

  for (const dirPath of Array.from(new Set(watchDirs))) {
    if (!existsSync(dirPath)) continue
    try {
      const watcher = watch(
        dirPath,
        { recursive: false },
        async (_eventType, filename) => {
          if (filename && filename.endsWith('.md')) {
            clearAgentCache()
            onChange?.()
          }
        },
      )
      watchers.push(watcher)
    } catch {
      continue
    }
  }
}

export async function stopAgentWatcher(): Promise<void> {
  try {
    for (const watcher of watchers) {
      try {
        watcher.close()
      } catch {}
    }
  } finally {
    watchers = []
  }
}
