import type { FeatureCandidate, FeaturePrimitives } from './types'
import { parseWindowLabel } from './windows'

const WINDOW_CONDITION =
  /^window\s*(<=|>=|<|>)\s*(\d+(?:s|m|h|d|w|mo|y))$/

export function evaluateBusinessRule(
  condition: string,
  candidate: FeatureCandidate,
  primitives: FeaturePrimitives,
): boolean {
  const clauses = condition
    .split('&&')
    .map(part => part.trim())
    .filter(Boolean)

  return clauses.every(clause =>
    evaluateClause(clause, candidate, primitives),
  )
}

function evaluateClause(
  clause: string,
  candidate: FeatureCandidate,
  primitives: FeaturePrimitives,
): boolean {
  const windowMatch = clause.match(WINDOW_CONDITION)
  if (windowMatch) {
    const operator = windowMatch[1]
    const targetLabel = windowMatch[2]
    const target = parseWindowLabel(targetLabel)
    if (!target) return false
    return compareWindow(candidate.window.seconds, target.seconds, operator)
  }

  const token = clause.toLowerCase()
  if (token === 'ratio') {
    return candidate.calculation === 'ratio' || candidate.family === 'ratio'
  }
  if (token === 'lifecycle') {
    return candidate.family === 'lifecycle'
  }
  if (token === 'network') {
    return candidate.family === 'network'
  }
  if (
    token === 'mom' ||
    token === 'yoy' ||
    token === 'grad' ||
    token === 'slope' ||
    token === 'incr' ||
    token === 'diff'
  ) {
    return candidate.calculation === token
  }

  const subject = primitives.subjects.find(
    s => s.id === token || s.prefix === token,
  )
  if (subject) {
    return candidate.subjectId === subject.id
  }

  return false
}

function compareWindow(
  candidateSeconds: number,
  targetSeconds: number,
  operator: string,
): boolean {
  switch (operator) {
    case '<':
      return candidateSeconds < targetSeconds
    case '<=':
      return candidateSeconds <= targetSeconds
    case '>':
      return candidateSeconds > targetSeconds
    case '>=':
      return candidateSeconds >= targetSeconds
    default:
      return false
  }
}
