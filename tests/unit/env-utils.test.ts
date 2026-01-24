import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import {
  validateEnvironment,
  getEnvString,
  getEnvNumber,
  getEnvBoolean,
} from '@utils/config/env'

describe('Environment Utils', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    // Clear test-related env vars
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.OPENAI_API_KEY
    delete process.env.CORINT_API_KEY
    delete process.env.CORINT_MAX_TOKENS
    delete process.env.CORINT_TIMEOUT
    delete process.env.CORINT_DEBUG
    delete process.env.CORINT_USE_BEDROCK
    delete process.env.CORINT_USE_VERTEX
  })

  afterEach(() => {
    // Restore original env
    Object.keys(process.env).forEach(key => {
      if (!(key in originalEnv)) {
        delete process.env[key]
      }
    })
    Object.assign(process.env, originalEnv)
  })

  describe('validateEnvironment', () => {
    test('returns warning when no API key is set', () => {
      const result = validateEnvironment()
      expect(result.warnings.some(w => w.includes('No API key found'))).toBe(true)
    })

    test('no API key warning when ANTHROPIC_API_KEY is set', () => {
      process.env.ANTHROPIC_API_KEY = 'test-key'
      const result = validateEnvironment()
      expect(result.warnings.some(w => w.includes('No API key found'))).toBe(false)
    })

    test('returns error for invalid numeric env var', () => {
      process.env.CORINT_MAX_TOKENS = 'not-a-number'
      const result = validateEnvironment()
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('CORINT_MAX_TOKENS'))).toBe(true)
    })

    test('returns warning for conflicting cloud providers', () => {
      process.env.CORINT_USE_BEDROCK = '1'
      process.env.CORINT_USE_VERTEX = '1'
      const result = validateEnvironment()
      expect(result.warnings.some(w => w.includes('BEDROCK') && w.includes('VERTEX'))).toBe(true)
    })

    test('valid when properly configured', () => {
      process.env.ANTHROPIC_API_KEY = 'test-key'
      process.env.CORINT_MAX_TOKENS = '4096'
      const result = validateEnvironment()
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })
  })

  describe('getEnvString', () => {
    test('returns env value when set', () => {
      process.env.TEST_STRING = 'hello'
      expect(getEnvString('TEST_STRING')).toBe('hello')
      delete process.env.TEST_STRING
    })

    test('returns default when not set', () => {
      expect(getEnvString('NONEXISTENT_VAR', 'default')).toBe('default')
    })

    test('returns empty string as default', () => {
      expect(getEnvString('NONEXISTENT_VAR')).toBe('')
    })
  })

  describe('getEnvNumber', () => {
    test('returns parsed number when valid', () => {
      process.env.TEST_NUMBER = '42'
      expect(getEnvNumber('TEST_NUMBER', 0)).toBe(42)
      delete process.env.TEST_NUMBER
    })

    test('returns default when not set', () => {
      expect(getEnvNumber('NONEXISTENT_VAR', 100)).toBe(100)
    })

    test('returns default when invalid number', () => {
      process.env.TEST_NUMBER = 'invalid'
      expect(getEnvNumber('TEST_NUMBER', 50)).toBe(50)
      delete process.env.TEST_NUMBER
    })

    test('handles float values', () => {
      process.env.TEST_NUMBER = '3.14'
      expect(getEnvNumber('TEST_NUMBER', 0)).toBe(3.14)
      delete process.env.TEST_NUMBER
    })
  })

  describe('getEnvBoolean', () => {
    test('returns true for truthy values', () => {
      const truthyValues = ['1', 'true', 'yes', 'on', 'TRUE', 'Yes', 'ON']
      for (const value of truthyValues) {
        process.env.TEST_BOOL = value
        expect(getEnvBoolean('TEST_BOOL')).toBe(true)
      }
      delete process.env.TEST_BOOL
    })

    test('returns false for falsy values', () => {
      const falsyValues = ['0', 'false', 'no', 'off', 'FALSE', 'No', 'OFF', '']
      for (const value of falsyValues) {
        process.env.TEST_BOOL = value
        expect(getEnvBoolean('TEST_BOOL')).toBe(false)
      }
      delete process.env.TEST_BOOL
    })

    test('returns default when not set', () => {
      expect(getEnvBoolean('NONEXISTENT_VAR', true)).toBe(true)
      expect(getEnvBoolean('NONEXISTENT_VAR', false)).toBe(false)
    })

    test('returns default for unrecognized values', () => {
      process.env.TEST_BOOL = 'maybe'
      expect(getEnvBoolean('TEST_BOOL', true)).toBe(true)
      expect(getEnvBoolean('TEST_BOOL', false)).toBe(false)
      delete process.env.TEST_BOOL
    })
  })
})
