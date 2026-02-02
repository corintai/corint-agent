import type { FeatureCandidate, FeatureSubject } from './types'

const STABILITY_SCORE: Record<string, number> = {
  high: 0.9,
  medium: 0.7,
  low: 0.5,
}

export function scoreCandidate(
  candidate: FeatureCandidate,
  subject?: FeatureSubject,
): number {
  const stability =
    candidate.subjectStability ||
    subject?.stability ||
    ('medium' as const)
  const stabilityScore = STABILITY_SCORE[stability] || 0.6
  const windowPenalty = candidate.window.seconds > 86400 * 365 ? 0.1 : 0
  const realtimeBoost = candidate.windowGroupType === 'realtime' ? 0.05 : 0
  return clamp(stabilityScore + realtimeBoost - windowPenalty, 0, 1)
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
