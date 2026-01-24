import { execFileNoThrow } from '@utils/system/execFileNoThrow'
import { memoize } from 'lodash-es'
import { join } from 'path'
import { homedir } from 'os'
import { CONFIG_BASE_DIR, CONFIG_FILE } from '@constants/product'

/**
 * Environment variable validation result
 */
export interface EnvValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

/**
 * Validates required and optional environment variables.
 * Call this at startup to catch configuration issues early.
 * @returns Validation result with errors and warnings
 */
export function validateEnvironment(): EnvValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Check for API key (at least one should be set for most operations)
  const hasApiKey = !!(
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.CORINT_API_KEY
  )
  if (!hasApiKey) {
    warnings.push('No API key found. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or CORINT_API_KEY for LLM operations.')
  }

  // Validate numeric environment variables
  const numericVars = ['CORINT_MAX_TOKENS', 'CORINT_TIMEOUT', 'CORINT_MAX_RETRIES']
  for (const varName of numericVars) {
    const value = process.env[varName]
    if (value !== undefined && isNaN(Number(value))) {
      errors.push(`${varName} must be a number, got: "${value}"`)
    }
  }

  // Validate boolean environment variables
  const booleanVars = ['CORINT_DEBUG', 'CORINT_OFFLINE', 'CI']
  const validBooleans = ['0', '1', 'true', 'false', 'yes', 'no', 'on', 'off', '']
  for (const varName of booleanVars) {
    const value = process.env[varName]
    if (value !== undefined && !validBooleans.includes(value.toLowerCase())) {
      warnings.push(`${varName} has unusual value "${value}". Expected: true/false/1/0`)
    }
  }

  // Check for conflicting configurations
  if (process.env.CORINT_USE_BEDROCK && process.env.CORINT_USE_VERTEX) {
    warnings.push('Both CORINT_USE_BEDROCK and CORINT_USE_VERTEX are set. Only one cloud provider should be active.')
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * Gets an environment variable with type coercion and default value.
 * @param name - Environment variable name
 * @param defaultValue - Default value if not set
 * @returns The environment variable value or default
 */
export function getEnvString(name: string, defaultValue: string = ''): string {
  return process.env[name] ?? defaultValue
}

/**
 * Gets a numeric environment variable with validation.
 * @param name - Environment variable name
 * @param defaultValue - Default value if not set or invalid
 * @returns The parsed number or default
 */
export function getEnvNumber(name: string, defaultValue: number): number {
  const value = process.env[name]
  if (value === undefined) return defaultValue
  const parsed = Number(value)
  return isNaN(parsed) ? defaultValue : parsed
}

/**
 * Gets a boolean environment variable.
 * Recognizes: 1, true, yes, on (truthy) and 0, false, no, off, empty (falsy)
 * @param name - Environment variable name
 * @param defaultValue - Default value if not set
 * @returns The boolean value
 */
export function getEnvBoolean(name: string, defaultValue: boolean = false): boolean {
  const value = process.env[name]
  if (value === undefined) return defaultValue
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off', ''].includes(normalized)) return false
  return defaultValue
}

export function getCorintBaseDir(): string {
  return (
    process.env.CORINT_CONFIG_DIR ??
    process.env.CLAUDE_CONFIG_DIR ??
    join(homedir(), CONFIG_BASE_DIR)
  )
}

export function getGlobalConfigFilePath(): string {
  return process.env.CORINT_CONFIG_DIR || process.env.CLAUDE_CONFIG_DIR
    ? join(getCorintBaseDir(), 'config.json')
    : join(homedir(), CONFIG_FILE)
}

export function getMemoryDir(): string {
  return join(getCorintBaseDir(), 'memory')
}

export const CORINT_BASE_DIR = getCorintBaseDir()
export const GLOBAL_CONFIG_FILE = getGlobalConfigFilePath()
export const MEMORY_DIR = getMemoryDir()

const getIsDocker = memoize(async (): Promise<boolean> => {
  const { code } = await execFileNoThrow('test', ['-f', '/.dockerenv'])
  if (code !== 0) {
    return false
  }
  return process.platform === 'linux'
})

const hasInternetAccess = memoize(async (): Promise<boolean> => {
  const offline =
    process.env.CORINT_OFFLINE ??
    process.env.OFFLINE ??
    process.env.NO_NETWORK ??
    ''
  const normalized = String(offline).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return false
  return true
})

export const env = {
  getIsDocker,
  hasInternetAccess,
  isCI: Boolean(process.env.CI),
  platform:
    process.platform === 'win32'
      ? 'windows'
      : process.platform === 'darwin'
        ? 'macos'
        : 'linux',
  osVersion: process.env.OS || process.platform,
  nodeVersion: process.version,
  terminal: process.env.TERM_PROGRAM,
}
