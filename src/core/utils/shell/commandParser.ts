/**
 * Safe command parsing utilities for shell command execution.
 * Provides secure parsing of shell commands to prevent injection attacks.
 */

/**
 * Characters that have special meaning in shell and should be handled carefully
 */
const SHELL_METACHARACTERS = /[;&|`$(){}[\]<>!#*?~]/

/**
 * Dangerous command patterns that should be blocked
 */
const DANGEROUS_PATTERNS = [
  /\$\(.*\)/,           // Command substitution $(...)
  /`.*`/,               // Backtick command substitution
  /\|\s*\w+/,           // Pipe to another command
  /;\s*\w+/,            // Command chaining with ;
  /&&\s*\w+/,           // Command chaining with &&
  /\|\|\s*\w+/,         // Command chaining with ||
  />\s*\/etc\//,        // Write to /etc
  />\s*\/usr\//,        // Write to /usr
  />\s*\/bin\//,        // Write to /bin
  /rm\s+-rf?\s+\//,     // Dangerous rm commands
]

/**
 * Allowed commands for custom command execution
 */
const ALLOWED_COMMANDS = new Set([
  'echo',
  'cat',
  'head',
  'tail',
  'wc',
  'date',
  'pwd',
  'whoami',
  'hostname',
  'uname',
  'ls',
  'find',
  'grep',
  'which',
  'env',
  'printenv',
  'git',
  'node',
  'npm',
  'npx',
  'yarn',
  'pnpm',
  'bun',
])

/**
 * Result of command validation
 */
export interface CommandValidationResult {
  valid: boolean
  command?: string
  args?: string[]
  error?: string
}

/**
 * Validates and parses a shell command string safely.
 * Rejects commands with dangerous patterns or disallowed executables.
 *
 * @param commandString - The raw command string to parse
 * @param options - Parsing options
 * @returns Validation result with parsed command and args if valid
 */
export function parseCommandSafely(
  commandString: string,
  options?: {
    allowedCommands?: Set<string>
    allowShellMetacharacters?: boolean
  }
): CommandValidationResult {
  const allowedCommands = options?.allowedCommands ?? ALLOWED_COMMANDS
  const allowMeta = options?.allowShellMetacharacters ?? false

  // Trim and check for empty command
  const trimmed = commandString.trim()
  if (!trimmed) {
    return { valid: false, error: 'Empty command' }
  }

  // Check for dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { valid: false, error: `Command contains dangerous pattern: ${pattern}` }
    }
  }

  // Check for shell metacharacters if not allowed
  if (!allowMeta && SHELL_METACHARACTERS.test(trimmed)) {
    return { valid: false, error: 'Command contains shell metacharacters' }
  }

  // Parse command and arguments
  // Handle quoted strings properly
  const tokens = tokenizeCommand(trimmed)
  if (tokens.length === 0) {
    return { valid: false, error: 'Failed to parse command' }
  }

  const [command, ...args] = tokens

  // Validate command is in allowed list
  const baseCommand = command.includes('/') ? command.split('/').pop()! : command
  if (!allowedCommands.has(baseCommand)) {
    return { valid: false, error: `Command '${baseCommand}' is not in the allowed list` }
  }

  return {
    valid: true,
    command,
    args,
  }
}

/**
 * Tokenizes a command string, respecting quoted strings.
 * @param input - The command string to tokenize
 * @returns Array of tokens
 */
function tokenizeCommand(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inSingleQuote = false
  let inDoubleQuote = false
  let escaped = false

  for (let i = 0; i < input.length; i++) {
    const char = input[i]

    if (escaped) {
      current += char
      escaped = false
      continue
    }

    if (char === '\\' && !inSingleQuote) {
      escaped = true
      continue
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
      continue
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
      continue
    }

    if (char === ' ' && !inSingleQuote && !inDoubleQuote) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }

    current += char
  }

  if (current) {
    tokens.push(current)
  }

  return tokens
}

/**
 * Escapes a string for safe use as a shell argument.
 * @param arg - The argument to escape
 * @returns Escaped argument safe for shell use
 */
export function escapeShellArg(arg: string): string {
  // If the argument contains no special characters, return as-is
  if (/^[a-zA-Z0-9._\-/=]+$/.test(arg)) {
    return arg
  }
  // Otherwise, wrap in single quotes and escape any single quotes within
  return `'${arg.replace(/'/g, "'\\''")}'`
}

/**
 * Checks if a command string appears to be safe for execution.
 * This is a quick check, not a full validation.
 * @param command - The command to check
 * @returns True if the command appears safe
 */
export function isCommandSafe(command: string): boolean {
  const result = parseCommandSafely(command)
  return result.valid
}
