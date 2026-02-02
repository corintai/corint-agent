import type { FeatureCandidate, FeaturePrimitives } from './types'
import { getAllWindows } from './windows'

export function validateCandidateAgainstPrimitives(
  candidate: FeatureCandidate,
  primitives: FeaturePrimitives,
): { valid: boolean; reason?: string } {
  const subject = primitives.subjects.find(s => s.id === candidate.subjectId)
  if (!subject) {
    return { valid: false, reason: 'subject not defined in primitives' }
  }
  if (subject.prefix !== candidate.subjectPrefix) {
    return { valid: false, reason: 'subject prefix mismatch' }
  }

  const metricIds = new Set(
    Object.values(primitives.aggregations || {}).flatMap(list =>
      (list || []).map(agg => agg.id),
    ),
  )
  if (!metricIds.has(candidate.metric)) {
    return { valid: false, reason: 'metric not defined in primitives' }
  }

  if (candidate.calculation) {
    const calcPrefixes = new Set(
      primitives.calculation_methods?.map(method => method.prefix) || [],
    )
    if (!calcPrefixes.has(candidate.calculation)) {
      return { valid: false, reason: 'calculation not defined in primitives' }
    }
  }

  if (primitives.objects && primitives.objects.length > 0) {
    if (!primitives.objects.includes(candidate.object)) {
      return { valid: false, reason: 'object not defined in primitives' }
    }
  }

  if (candidate.event) {
    const eventIds = new Set(primitives.events.map(event => event.id))
    if (!eventIds.has(candidate.event)) {
      return { valid: false, reason: 'event not defined in primitives' }
    }
  }

  if (candidate.dimension && primitives.dimensions && primitives.dimensions.length > 0) {
    if (!primitives.dimensions.includes(candidate.dimension)) {
      return { valid: false, reason: 'dimension not defined in primitives' }
    }
  }

  const allowedWindows = new Set(
    getAllWindows(primitives.time_windows || {}).map(window => window.label),
  )
  if (candidate.window?.label && !allowedWindows.has(candidate.window.label)) {
    return { valid: false, reason: 'window not defined in primitives' }
  }

  return { valid: true }
}
