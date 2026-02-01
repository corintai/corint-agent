import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { ComputeIvTool } from '@tools/credit/ComputeIvTool/ComputeIvTool'

const makeContext = () => ({
  abortController: new AbortController(),
  messageId: 'test',
  readFileTimestamps: {},
})

async function runComputeIv(input: any) {
  const gen = ComputeIvTool.call(input, makeContext() as any)
  const first = await gen.next()
  expect(first.done).toBe(false)
  if (first.done || !first.value) {
    throw new Error('Expected ComputeIvTool to yield a result')
  }
  if (first.value.type !== 'result') {
    throw new Error(
      `Expected ComputeIvTool to yield result, got: ${first.value.type}`,
    )
  }
  return first.value
}

describe('ComputeIvTool', () => {
  test('aligns target values with valid feature rows and reports skip reasons', async () => {
    const filePath = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      'fixtures',
      'credit',
      'compute-iv.csv',
    )

    const result = await runComputeIv({
      filePath,
      features: ['feature', 'all_missing', 'missing_feature'],
      target: 'target',
      bins: 2,
      method: 'equal_width',
    })

    if (typeof result.data === 'string') {
      throw new Error(`Expected structured output, got string: ${result.data}`)
    }

    expect(result.data.summary.totalFeatures).toBe(1)
    expect(result.data.summary.skippedFeatures).toEqual([
      'all_missing',
      'missing_feature',
    ])
    expect(result.data.summary.skippedDetails).toEqual([
      { feature: 'all_missing', reason: 'no_valid_rows' },
      { feature: 'missing_feature', reason: 'missing' },
    ])

    const woe = result.data.woe.find(item => item.feature === 'feature')
    expect(woe).toBeDefined()
    if (!woe) return

    const counts = woe.bins
      .map(bin => [bin.goodCount, bin.badCount])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    expect(counts).toEqual([
      [1, 2],
      [2, 1],
    ])
  })
})
