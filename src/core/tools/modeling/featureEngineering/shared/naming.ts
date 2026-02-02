import type {
  FeatureCandidate,
  FeaturePrimitives,
} from './types'
import { parseWindowLabel, parseWindowPairFromParts } from './windows'

const WINDOW_TOKEN_PATTERN = /^(\d+)(s|m|h|d|w|mo|y)$/

export interface FeatureNameComponents {
  subject: string
  calculation?: string
  metric: string
  object: string
  event?: string
  dimension?: string
  window?: string
  windowPair?: string
}

export function buildFeatureName(
  components: FeatureNameComponents,
  primitives: FeaturePrimitives,
): string {
  const parts = [
    components.subject,
    components.calculation,
    components.metric,
    components.object,
    components.event,
    components.dimension,
    components.windowPair ?? components.window,
  ].filter(part => part && String(part).length > 0) as string[]

  const name = parts.join(primitives.naming_convention.separator || '_')
  return name.toLowerCase()
}

export function candidateToName(
  candidate: FeatureCandidate,
  primitives: FeaturePrimitives,
): string {
  return buildFeatureName(
    {
      subject: candidate.subjectPrefix,
      calculation: candidate.calculation,
      metric: candidate.metric,
      object: candidate.object,
      event: candidate.event,
      dimension: candidate.dimension,
      window: candidate.window.label,
    },
    primitives,
  )
}

export function parseFeatureName(
  name: string,
  primitives: FeaturePrimitives,
): FeatureNameComponents | null {
  const separator = primitives.naming_convention.separator || '_'
  const parts = name.split(separator).filter(p => p.length > 0)
  if (parts.length < 3) return null

  const subject = parts[0]
  const calculationPrefixes = new Set(
    primitives.calculation_methods?.map(method => method.prefix) || [],
  )

  let index = 1
  let calculation: string | undefined
  if (parts[index] && calculationPrefixes.has(parts[index])) {
    calculation = parts[index]
    index += 1
  }

  const metric = parts[index]
  index += 1

  const { window, windowPair, remaining } = parseWindowPairFromParts(
    parts.slice(index),
  )

  const leftovers = remaining
  const object = leftovers[0]
  const event = leftovers[1]
  const dimension = leftovers[2]

  return {
    subject,
    calculation,
    metric,
    object,
    event,
    dimension,
    window: window?.label,
    windowPair,
  }
}

export function validateFeatureName(
  name: string,
  primitives: FeaturePrimitives,
): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  const { naming_convention: convention } = primitives

  if (name.length > convention.max_length) {
    errors.push(`feature name exceeds max length ${convention.max_length}`)
  }
  if (name.includes('__')) {
    errors.push('feature name contains consecutive underscores')
  }
  if (name.startsWith('_') || name.endsWith('_')) {
    errors.push('feature name has leading or trailing underscore')
  }
  if (name.toLowerCase() !== name) {
    errors.push('feature name must be lowercase')
  }

  const parsed = parseFeatureName(name, primitives)
  if (!parsed) {
    errors.push('feature name is not parsable')
    return { valid: errors.length === 0, errors }
  }

  const subjectPrefixes = new Set(
    primitives.subjects.map(subject => subject.prefix),
  )
  if (!subjectPrefixes.has(parsed.subject)) {
    errors.push('subject prefix not found in primitives')
  }

  const allMetrics = new Set(
    Object.values(primitives.aggregations || {}).flatMap(list =>
      (list || []).map(item => item.id),
    ),
  )
  if (!allMetrics.has(parsed.metric)) {
    errors.push('metric not found in primitives')
  }

  if (parsed.window && !WINDOW_TOKEN_PATTERN.test(parsed.window)) {
    errors.push('window format invalid')
  }

  if (parsed.windowPair) {
    const [left, right] = parsed.windowPair.split('_')
    if (!WINDOW_TOKEN_PATTERN.test(left) || !WINDOW_TOKEN_PATTERN.test(right)) {
      errors.push('window pair format invalid')
    }
  }

  if (!parsed.object) {
    errors.push('object is required')
  }

  return { valid: errors.length === 0, errors }
}
