/**
 * Unified error handling utilities for consistent error processing across the codebase.
 */

import { debug as debugLogger } from '@utils/log/debugLogger'

/**
 * Error categories for classification and handling
 */
export type ErrorCategory =
  | 'PARSE_ERROR'
  | 'NETWORK_ERROR'
  | 'PERMISSION_ERROR'
  | 'VALIDATION_ERROR'
  | 'TIMEOUT_ERROR'
  | 'UNKNOWN_ERROR'

/**
 * Structured error information
 */
export interface ErrorInfo {
  category: ErrorCategory
  message: string
  originalError?: unknown
  context?: Record<string, unknown>
}

/**
 * Permission error codes from Node.js
 */
const PERMISSION_ERROR_CODES = new Set(['EACCES', 'EPERM', 'EROFS'])

/**
 * Network error codes from Node.js
 */
const NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
])

/**
 * Extracts error message from unknown error type
 * @param error - The error to extract message from
 * @returns The error message string
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  return String(error)
}

/**
 * Extracts error stack from unknown error type
 * @param error - The error to extract stack from
 * @returns The error stack string or undefined
 */
export function getErrorStack(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.stack
  }
  return undefined
}

/**
 * Checks if error is a permission error
 * @param error - The error to check
 * @returns True if it's a permission error
 */
export function isPermissionError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    PERMISSION_ERROR_CODES.has((error as NodeJS.ErrnoException).code ?? '')
  )
}

/**
 * Checks if error is a network error
 * @param error - The error to check
 * @returns True if it's a network error
 */
export function isNetworkError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    NETWORK_ERROR_CODES.has((error as NodeJS.ErrnoException).code ?? '')
  )
}

/**
 * Checks if error is a timeout error
 * @param error - The error to check
 * @returns True if it's a timeout error
 */
export function isTimeoutError(error: unknown): boolean {
  if (error instanceof Error) {
    return (
      error.name === 'TimeoutError' ||
      error.message.toLowerCase().includes('timeout') ||
      (error as NodeJS.ErrnoException).code === 'ETIMEDOUT'
    )
  }
  return false
}

/**
 * Categorizes an error into predefined categories
 * @param error - The error to categorize
 * @returns The error category
 */
export function categorizeError(error: unknown): ErrorCategory {
  if (isPermissionError(error)) return 'PERMISSION_ERROR'
  if (isNetworkError(error)) return 'NETWORK_ERROR'
  if (isTimeoutError(error)) return 'TIMEOUT_ERROR'
  if (error instanceof SyntaxError) return 'PARSE_ERROR'
  if (error instanceof TypeError || error instanceof RangeError) return 'VALIDATION_ERROR'
  return 'UNKNOWN_ERROR'
}

/**
 * Creates structured error info from an error
 * @param error - The error to process
 * @param context - Additional context information
 * @returns Structured error information
 */
export function createErrorInfo(
  error: unknown,
  context?: Record<string, unknown>,
): ErrorInfo {
  return {
    category: categorizeError(error),
    message: getErrorMessage(error),
    originalError: error,
    context,
  }
}

/**
 * Safely executes a function and returns a result or error
 * @param fn - The function to execute
 * @returns Tuple of [result, error]
 */
export async function safeAsync<T>(
  fn: () => Promise<T>,
): Promise<[T, null] | [null, ErrorInfo]> {
  try {
    const result = await fn()
    return [result, null]
  } catch (error) {
    return [null, createErrorInfo(error)]
  }
}

/**
 * Safely executes a synchronous function and returns a result or error
 * @param fn - The function to execute
 * @returns Tuple of [result, error]
 */
export function safeSync<T>(fn: () => T): [T, null] | [null, ErrorInfo] {
  try {
    const result = fn()
    return [result, null]
  } catch (error) {
    return [null, createErrorInfo(error)]
  }
}

/**
 * Safely parses JSON with error logging
 * @param jsonString - The JSON string to parse
 * @param logTag - Tag for debug logging
 * @param context - Additional context for logging
 * @returns Parsed object or null on failure
 */
export function safeJsonParse<T = unknown>(
  jsonString: string,
  logTag?: string,
  context?: Record<string, unknown>,
): T | null {
  try {
    return JSON.parse(jsonString) as T
  } catch (error) {
    if (logTag) {
      debugLogger.warn(logTag, {
        error: getErrorMessage(error),
        jsonPreview: jsonString.slice(0, 200),
        ...context,
      })
    }
    return null
  }
}

/**
 * Wraps a function to catch and log errors without throwing
 * @param fn - The function to wrap
 * @param logTag - Tag for debug logging
 * @param defaultValue - Default value to return on error
 * @returns Wrapped function that doesn't throw
 */
export function withErrorLogging<T, Args extends unknown[]>(
  fn: (...args: Args) => T,
  logTag: string,
  defaultValue: T,
): (...args: Args) => T {
  return (...args: Args): T => {
    try {
      return fn(...args)
    } catch (error) {
      debugLogger.warn(logTag, {
        error: getErrorMessage(error),
        args: args.map(arg =>
          typeof arg === 'string' ? arg.slice(0, 100) : typeof arg,
        ),
      })
      return defaultValue
    }
  }
}

/**
 * Wraps an async function to catch and log errors without throwing
 * @param fn - The async function to wrap
 * @param logTag - Tag for debug logging
 * @param defaultValue - Default value to return on error
 * @returns Wrapped async function that doesn't throw
 */
export function withAsyncErrorLogging<T, Args extends unknown[]>(
  fn: (...args: Args) => Promise<T>,
  logTag: string,
  defaultValue: T,
): (...args: Args) => Promise<T> {
  return async (...args: Args): Promise<T> => {
    try {
      return await fn(...args)
    } catch (error) {
      debugLogger.warn(logTag, {
        error: getErrorMessage(error),
        args: args.map(arg =>
          typeof arg === 'string' ? arg.slice(0, 100) : typeof arg,
        ),
      })
      return defaultValue
    }
  }
}
