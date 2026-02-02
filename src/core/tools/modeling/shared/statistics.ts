import type { Bin, WoeBin } from './types'

export function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

export function variance(values: number[]): number {
  if (values.length === 0) return 0
  const avg = mean(values)
  const squareDiffs = values.map(v => Math.pow(v - avg, 2))
  return mean(squareDiffs)
}

export function std(values: number[]): number {
  return Math.sqrt(variance(values))
}

export function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const pos = (sorted.length - 1) * q
  const base = Math.floor(pos)
  const rest = pos - base
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base])
  }
  return sorted[base]
}

export function computePSI(
  baseline: number[],
  current: number[],
  bins: Bin[],
): number {
  let psi = 0
  const baselineTotal = baseline.length
  const currentTotal = current.length

  for (const bin of bins) {
    const baselineCount = baseline.filter(
      v => v > bin.min && v <= bin.max,
    ).length
    const currentCount = current.filter(v => v > bin.min && v <= bin.max).length

    const baselinePct = baselineCount / baselineTotal
    const currentPct = currentCount / currentTotal

    // Avoid log(0) by adding small epsilon
    const epsilon = 0.0001
    const adjustedBaselinePct = Math.max(baselinePct, epsilon)
    const adjustedCurrentPct = Math.max(currentPct, epsilon)

    psi +=
      (adjustedCurrentPct - adjustedBaselinePct) *
      Math.log(adjustedCurrentPct / adjustedBaselinePct)
  }

  return psi
}

export function computeIV(
  feature: number[],
  target: number[],
  bins: Bin[],
): { iv: number; woeBins: WoeBin[] } {
  let totalIV = 0
  const woeBins: WoeBin[] = []

  const totalGood = target.filter(t => t === 0).length
  const totalBad = target.filter(t => t === 1).length

  if (totalGood === 0 || totalBad === 0) {
    return { iv: 0, woeBins: [] }
  }

  for (const bin of bins) {
    const indices = feature
      .map((v, i) => (v > bin.min && v <= bin.max ? i : -1))
      .filter(i => i !== -1)

    const goodCount = indices.filter(i => target[i] === 0).length
    const badCount = indices.filter(i => target[i] === 1).length

    const goodPct = goodCount / totalGood
    const badPct = badCount / totalBad

    // Avoid log(0) and division by zero
    const epsilon = 0.0001
    const adjustedGoodPct = Math.max(goodPct, epsilon)
    const adjustedBadPct = Math.max(badPct, epsilon)

    const woe = Math.log(adjustedGoodPct / adjustedBadPct)
    const iv = (adjustedGoodPct - adjustedBadPct) * woe

    totalIV += iv

    woeBins.push({
      range: bin.range,
      woe,
      iv,
      goodCount,
      badCount,
      goodRate: goodPct,
      badRate: badPct,
    })
  }

  return { iv: totalIV, woeBins }
}

export function interpretPSI(psi: number): {
  status: 'stable' | 'warning' | 'drift'
  interpretation: string
} {
  if (psi < 0.1) {
    return {
      status: 'stable',
      interpretation: 'No significant change detected',
    }
  } else if (psi < 0.25) {
    return {
      status: 'warning',
      interpretation: 'Moderate change detected, investigate further',
    }
  } else {
    return {
      status: 'drift',
      interpretation: 'Significant drift detected, model may need retraining',
    }
  }
}

export function interpretIV(iv: number): {
  predictivePower: 'weak' | 'medium' | 'strong' | 'suspicious'
  recommendation: string
} {
  if (iv < 0.02) {
    return {
      predictivePower: 'weak',
      recommendation: 'Not predictive, consider removing',
    }
  } else if (iv < 0.1) {
    return {
      predictivePower: 'medium',
      recommendation: 'Weak predictive power',
    }
  } else if (iv < 0.3) {
    return {
      predictivePower: 'strong',
      recommendation: 'Medium predictive power, good for modeling',
    }
  } else if (iv < 0.5) {
    return {
      predictivePower: 'strong',
      recommendation: 'Strong predictive power, excellent for modeling',
    }
  } else {
    return {
      predictivePower: 'suspicious',
      recommendation: 'Too high, check for data leakage',
    }
  }
}
