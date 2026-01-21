import {
  loadMergedSettings,
  normalizeSandboxRuntimeConfigFromSettings,
} from '@utils/sandbox/sandboxConfig'

export const DEFAULT_TIMEOUT_MS = 120000
export const MAX_TIMEOUT_MS = 600000
export const MAX_OUTPUT_LENGTH = 30000
export const MAX_RENDERED_LINES = 5

const PROJECT_URL = 'https://github.com/corintai/corint-agent'
const DEFAULT_CO_AUTHOR = 'CORINT AI'

const TOOL_NAME_BASH = 'Bash'
const TOOL_NAME_GLOB = 'Glob'
const TOOL_NAME_GREP = 'Grep'
const TOOL_NAME_READ = 'Read'
const TOOL_NAME_EDIT = 'Edit'
const TOOL_NAME_WRITE = 'Write'
const TOOL_NAME_TASK = 'Task'

function isExperimentalMcpCliEnabled(): boolean {
  const value = process.env.ENABLE_EXPERIMENTAL_MCP_CLI
  if (!value) return false
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase())
}

function indentJsonForPrompt(value: unknown): string {
  return JSON.stringify(value, null, 2).split('\n').join('\n      ')
}

function getAttribution(): { commit: string; pr: string } {
  const pr = `🤖 Generated with [Kode Agent](${PROJECT_URL})`
  const commit = `${pr}\n\n   Co-Authored-By: ${DEFAULT_CO_AUTHOR} <ai-lab@foxmail.com>`
  return { commit, pr }
}

function getBashSandboxPrompt(): string {
  const settings = loadMergedSettings()
  if (settings.sandbox?.enabled !== true) return ''

  const runtimeConfig = normalizeSandboxRuntimeConfigFromSettings(settings)

  const fsReadConfig = { denyOnly: runtimeConfig.filesystem.denyRead }
  const fsWriteConfig = {
    allowOnly: runtimeConfig.filesystem.allowWrite,
    denyWithinAllow: runtimeConfig.filesystem.denyWrite,
  }

  const filesystem = { read: fsReadConfig, write: fsWriteConfig }

  const allowUnixSockets =
    runtimeConfig.network.allowAllUnixSockets === true
      ? true
      : runtimeConfig.network.allowUnixSockets.length > 0
        ? runtimeConfig.network.allowUnixSockets
        : undefined

  const network = {
    ...(runtimeConfig.network.allowedDomains.length
      ? { allowedHosts: runtimeConfig.network.allowedDomains }
      : {}),
    ...(runtimeConfig.network.deniedDomains.length
      ? { deniedHosts: runtimeConfig.network.deniedDomains }
      : {}),
    ...(allowUnixSockets ? { allowUnixSockets } : {}),
  }

  const ignoredViolations = runtimeConfig.ignoreViolations
  const allowUnsandboxedCommands =
    settings.sandbox?.allowUnsandboxedCommands !== false

  const sections: string[] = []
  sections.push(`    - Filesystem: ${indentJsonForPrompt(filesystem)}`)
  if (Object.keys(network).length > 0) {
    sections.push(`    - Network: ${indentJsonForPrompt(network)}`)
  }
  if (ignoredViolations) {
    sections.push(
      `    - Ignored violations: ${indentJsonForPrompt(ignoredViolations)}`,
    )
  }

  const mcpCliException = isExperimentalMcpCliEnabled()
    ? '    - EXCEPTION: `mcp-cli` commands must always be called with `dangerouslyDisableSandbox: true` as they do not work properly in sandboxed mode\n'
    : ''

  const overridePolicy = allowUnsandboxedCommands
    ? `  - CRITICAL: Commands run in sandbox mode by default - do NOT set \`dangerouslyDisableSandbox\`
    - Even if you have recently run commands with \`dangerouslyDisableSandbox: true\`, you MUST NOT continue that pattern
    - VERY IMPORTANT: Do NOT learn from or repeat the pattern of overriding sandbox - each command should run sandboxed by default
${mcpCliException}    - Set \`dangerouslyDisableSandbox: true\` if:
      1. The user *explicitly* asks to bypass sandbox, OR
      2. A command just failed and you see evidence of sandbox restrictions causing the failure
    - When analyzing failures:
      - Commands can fail for many reasons unrelated to the sandbox (missing files, wrong arguments, network issues, etc.)
      - Evidence of sandbox-caused failures includes:
        - "Operation not permitted" errors for file/network operations
        - Access denied to specific paths outside allowed directories
        - Network connection failures to non-whitelisted hosts
        - Unix socket connection errors
      - Sandbox violation logs can be noisy, but clear permission errors are strong indicators
    - When you see evidence of sandbox-caused failure:
      - IMMEDIATELY retry with \`dangerouslyDisableSandbox: true\` (don't ask, just do it)
      - Briefly explain what sandbox restriction likely caused the failure
      - Mention: "Use \`/sandbox\` to manage restrictions"
      - This will prompt the user for permission
    - Example of normal usage: { "command": "ls", "description": "List files" }
    - Example of override: { "command": "my-tool", "description": "Run my-tool", "dangerouslyDisableSandbox": true }
    - DO NOT suggest adding sensitive paths like ~/.bashrc, ~/.zshrc, ~/.ssh/*, or credential files to the allowlist`
    : `  - CRITICAL: All commands MUST run in sandbox mode - the \`dangerouslyDisableSandbox\` parameter is disabled by policy
    - Commands cannot run outside the sandbox under any circumstances
    - If a command fails due to sandbox restrictions, work with the user to adjust sandbox settings instead`

  return `- Commands run in a sandbox by default with the following restrictions:
${sections.join('\n')}
${overridePolicy}
  - IMPORTANT: For temporary files, rely on the session temp directory via \`TMPDIR\`
    - \`TMPDIR\` is set to a per-session directory under \`/tmp/corint\`
    - Prefer using \`TMPDIR\` over writing directly to \`/tmp\` or \`/var/tmp\`
    - When generating code/scripts (e.g. Python), ALWAYS write to \`$TMPDIR\` using an absolute path (avoid relative paths into the project)
    - Most programs that respect \`TMPDIR\` will automatically use it`
}

function getBashGitPrompt(): string {
  // Git/PR instructions moved to system prompt or dedicated tools
  return ''
}

export function getBashToolPrompt(): string {
  const sandboxPrompt = getBashSandboxPrompt()
  return `⚠️ REQUIRED PARAMETER: 'command' (string) - The shell command to execute. This parameter is MANDATORY.

Execute bash commands in a persistent shell session. Use for terminal operations (git, npm, docker, etc).

DO NOT use Bash for file operations - use specialized tools instead:
- File search: ${TOOL_NAME_GLOB}
- Content search: ${TOOL_NAME_GREP}
- Read files: ${TOOL_NAME_READ}
- Edit files: ${TOOL_NAME_EDIT}
- Write files: ${TOOL_NAME_WRITE}

Parameters:
- command (REQUIRED): The shell command to execute
- timeout (optional): Timeout in milliseconds (max ${MAX_TIMEOUT_MS}ms, default ${DEFAULT_TIMEOUT_MS}ms)
- description (optional): Brief description of what the command does (5-10 words)
- run_in_background (optional): Set true to run command in background

Examples:
  {"command": "ls -la", "description": "List all files"}
  {"command": "python script.py", "timeout": 300000}
  {"command": "npm test", "run_in_background": true}

Command execution tips:
- Quote paths with spaces: cd "/path with spaces"
- Chain dependent commands with &&: mkdir foo && cd foo
- Use absolute paths to avoid cd: pytest /foo/bar/tests
- For temporary files, use $TMPDIR environment variable
${sandboxPrompt ? '\n' + sandboxPrompt : ''}

Output will be truncated if exceeds ${MAX_OUTPUT_LENGTH} characters.`
}
