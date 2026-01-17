import { describe, expect, test } from 'bun:test'
import pkg from '../../package.json'
import { MACRO } from '../../src/core/utils/macros'

describe('repo scaffold', () => {
  test('MACRO.VERSION matches package.json', () => {
    expect(MACRO.VERSION).toBe(pkg.version)
  })
})
