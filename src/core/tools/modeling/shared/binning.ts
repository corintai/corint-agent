import type { Bin, BinningOptions } from './types'
import { quantile } from './statistics'

export function createBins(
  values: number[],
  options: BinningOptions,
): Bin[] {
  const validValues = values.filter(v => !isNaN(v) && isFinite(v))
  if (validValues.length === 0) {
    return []
  }

  switch (options.method) {
    case 'quantile':
      return quantileBinning(validValues, options.bins)
    case 'equal_width':
      return equalWidthBinning(validValues, options.bins)
    case 'tree':
      return treeBinning(validValues, options.bins)
    default:
      return quantileBinning(validValues, options.bins)
  }
}

function quantileBinning(values: number[], numBins: number): Bin[] {
  const sorted = [...values].sort((a, b) => a - b)
  const bins: Bin[] = []

  for (let i = 0; i < numBins; i++) {
    const qLow = i / numBins
    const qHigh = (i + 1) / numBins

    const min = i === 0 ? -Infinity : quantile(sorted, qLow)
    const max = i === numBins - 1 ? Infinity : quantile(sorted, qHigh)

    const count = sorted.filter(v => v > min && v <= max).length
    const percentage = count / sorted.length

    bins.push({
      range: formatRange(min, max),
      min,
      max,
      count,
      percentage,
    })
  }

  return bins
}

function equalWidthBinning(values: number[], numBins: number): Bin[] {
  const sorted = [...values].sort((a, b) => a - b)
  const minVal = sorted[0]
  const maxVal = sorted[sorted.length - 1]
  const width = (maxVal - minVal) / numBins

  const bins: Bin[] = []

  for (let i = 0; i < numBins; i++) {
    const min = i === 0 ? -Infinity : minVal + i * width
    const max = i === numBins - 1 ? Infinity : minVal + (i + 1) * width

    const count = sorted.filter(v => v > min && v <= max).length
    const percentage = count / sorted.length

    bins.push({
      range: formatRange(min, max),
      min,
      max,
      count,
      percentage,
    })
  }

  return bins
}

function treeBinning(values: number[], numBins: number): Bin[] {
  // Simplified tree-based binning (decision tree approach)
  // For now, use quantile binning as a fallback
  // TODO: Implement proper decision tree binning
  return quantileBinning(values, numBins)
}

function formatRange(min: number, max: number): string {
  const minStr = min === -Infinity ? '-∞' : min.toFixed(2)
  const maxStr = max === Infinity ? '+∞' : max.toFixed(2)
  return `(${minStr}, ${maxStr}]`
}

export function getIndicesInBin(values: number[], bin: Bin): number[] {
  return values
    .map((v, i) => (v > bin.min && v <= bin.max ? i : -1))
    .filter(i => i !== -1)
}

export function countInBin(values: number[], bin: Bin): number {
  return values.filter(v => v > bin.min && v <= bin.max).length
}
