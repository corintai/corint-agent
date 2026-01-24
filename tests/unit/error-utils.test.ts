import { describe, expect, test } from 'bun:test'
import {
  getErrorMessage,
  getErrorStack,
  isPermissionError,
  isNetworkError,
  isTimeoutError,
  categorizeError,
  createErrorInfo,
  safeSync,
  safeJsonParse,
} from '@utils/error'

describe('Error Utils', () => {
  describe('getErrorMessage', () => {
    test('extracts message from Error instance', () => {
      const error = new Error('Test error message')
      expect(getErrorMessage(error)).toBe('Test error message')
    })

    test('returns string as-is', () => {
      expect(getErrorMessage('String error')).toBe('String error')
    })

    test('converts other types to string', () => {
      expect(getErrorMessage(123)).toBe('123')
      expect(getErrorMessage(null)).toBe('null')
      expect(getErrorMessage(undefined)).toBe('undefined')
    })
  })

  describe('getErrorStack', () => {
    test('extracts stack from Error instance', () => {
      const error = new Error('Test')
      expect(getErrorStack(error)).toContain('Error: Test')
    })

    test('returns undefined for non-Error', () => {
      expect(getErrorStack('string')).toBeUndefined()
      expect(getErrorStack(123)).toBeUndefined()
    })
  })

  describe('isPermissionError', () => {
    test('identifies EACCES error', () => {
      const error = Object.assign(new Error('Permission denied'), { code: 'EACCES' })
      expect(isPermissionError(error)).toBe(true)
    })

    test('identifies EPERM error', () => {
      const error = Object.assign(new Error('Operation not permitted'), { code: 'EPERM' })
      expect(isPermissionError(error)).toBe(true)
    })

    test('returns false for other errors', () => {
      const error = new Error('Generic error')
      expect(isPermissionError(error)).toBe(false)
    })
  })

  describe('isNetworkError', () => {
    test('identifies ECONNREFUSED error', () => {
      const error = Object.assign(new Error('Connection refused'), { code: 'ECONNREFUSED' })
      expect(isNetworkError(error)).toBe(true)
    })

    test('identifies ETIMEDOUT error', () => {
      const error = Object.assign(new Error('Timed out'), { code: 'ETIMEDOUT' })
      expect(isNetworkError(error)).toBe(true)
    })

    test('returns false for non-network errors', () => {
      const error = new Error('Generic error')
      expect(isNetworkError(error)).toBe(false)
    })
  })

  describe('isTimeoutError', () => {
    test('identifies TimeoutError by name', () => {
      const error = new Error('Timeout')
      error.name = 'TimeoutError'
      expect(isTimeoutError(error)).toBe(true)
    })

    test('identifies timeout by message', () => {
      const error = new Error('Request timeout exceeded')
      expect(isTimeoutError(error)).toBe(true)
    })

    test('returns false for non-timeout errors', () => {
      const error = new Error('Generic error')
      expect(isTimeoutError(error)).toBe(false)
    })
  })

  describe('categorizeError', () => {
    test('categorizes permission errors', () => {
      const error = Object.assign(new Error('Permission denied'), { code: 'EACCES' })
      expect(categorizeError(error)).toBe('PERMISSION_ERROR')
    })

    test('categorizes network errors', () => {
      const error = Object.assign(new Error('Connection refused'), { code: 'ECONNREFUSED' })
      expect(categorizeError(error)).toBe('NETWORK_ERROR')
    })

    test('categorizes syntax errors as parse errors', () => {
      const error = new SyntaxError('Unexpected token')
      expect(categorizeError(error)).toBe('PARSE_ERROR')
    })

    test('categorizes type errors as validation errors', () => {
      const error = new TypeError('Invalid type')
      expect(categorizeError(error)).toBe('VALIDATION_ERROR')
    })

    test('categorizes unknown errors', () => {
      const error = new Error('Unknown')
      expect(categorizeError(error)).toBe('UNKNOWN_ERROR')
    })
  })

  describe('createErrorInfo', () => {
    test('creates structured error info', () => {
      const error = new Error('Test error')
      const info = createErrorInfo(error, { operation: 'test' })

      expect(info.message).toBe('Test error')
      expect(info.category).toBe('UNKNOWN_ERROR')
      expect(info.originalError).toBe(error)
      expect(info.context).toEqual({ operation: 'test' })
    })
  })

  describe('safeSync', () => {
    test('returns result on success', () => {
      const [result, error] = safeSync(() => 42)
      expect(result).toBe(42)
      expect(error).toBeNull()
    })

    test('returns error info on failure', () => {
      const [result, error] = safeSync(() => {
        throw new Error('Failed')
      })
      expect(result).toBeNull()
      expect(error).not.toBeNull()
      expect(error?.message).toBe('Failed')
    })
  })

  describe('safeJsonParse', () => {
    test('parses valid JSON', () => {
      const result = safeJsonParse('{"key": "value"}')
      expect(result).toEqual({ key: 'value' })
    })

    test('returns null for invalid JSON', () => {
      const result = safeJsonParse('invalid json')
      expect(result).toBeNull()
    })

    test('returns typed result', () => {
      const result = safeJsonParse<{ count: number }>('{"count": 5}')
      expect(result?.count).toBe(5)
    })
  })
})
