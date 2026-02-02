import type {
  FeatureCandidate,
  FeatureFamily,
  FeaturePrimitives,
  WindowSpec,
} from './types'
import { candidateToName } from './naming'
import { getAllWindows } from './windows'

export interface CandidateGenerationOptions {
  subjects?: string[]
  metrics?: string[]
  families?: FeatureFamily[]
  objects?: string[]
  events?: string[]
  dimensions?: string[]
  windows?: string[]
  includeCalculationMethods?: string[]
}

export function generateCandidates(
  primitives: FeaturePrimitives,
  options: CandidateGenerationOptions = {},
): FeatureCandidate[] {
  const subjects = primitives.subjects.filter(subject =>
    options.subjects ? options.subjects.includes(subject.id) : true,
  )

  const aggregationFamilies = primitives.aggregations || {}
  const familyEntries = Object.entries(aggregationFamilies).filter(
    ([family]) =>
      options.families ? options.families.includes(family as FeatureFamily) : true,
  )

  const metrics = new Map<string, FeatureFamily>()
  for (const [family, list] of familyEntries) {
    for (const agg of list || []) {
      if (options.metrics && !options.metrics.includes(agg.id)) {
        continue
      }
      metrics.set(agg.id, family as FeatureFamily)
    }
  }

  const objects = options.objects || primitives.objects || []
  if (objects.length === 0) {
    throw new Error('objects list is required in primitives or generation options')
  }

  const events = options.events || primitives.events.map(event => event.id)
  const dimensions = options.dimensions || primitives.dimensions || ['']

  const windows = getAllWindows(primitives.time_windows || {}).filter(window =>
    options.windows ? options.windows.includes(window.label) : true,
  )

  const candidates: FeatureCandidate[] = []

  for (const subject of subjects) {
    for (const [metric, family] of metrics.entries()) {
      for (const object of objects) {
        for (const event of events.length > 0 ? events : ['']) {
          for (const dimension of dimensions.length > 0 ? dimensions : ['']) {
            for (const window of windows) {
              const candidate: FeatureCandidate = {
                name: '',
                subjectId: subject.id,
                subjectPrefix: subject.prefix,
                subjectStability: subject.stability,
                metric,
                object,
                event: event || undefined,
                dimension: dimension || undefined,
                window,
                family,
                windowGroup: window.group,
                windowGroupType: window.groupType,
              }

              candidate.name = candidateToName(candidate, primitives)
              candidates.push(candidate)
            }
          }
        }
      }
    }
  }

  if (options.includeCalculationMethods?.length) {
    const derived: FeatureCandidate[] = []
    for (const candidate of candidates) {
      for (const calculation of options.includeCalculationMethods) {
        derived.push({
          ...candidate,
          calculation,
          name: candidateToName(
            { ...candidate, calculation } as FeatureCandidate,
            primitives,
          ),
        })
      }
    }
    return [...candidates, ...derived]
  }

  return candidates
}

export function windowToLabel(window: WindowSpec): string {
  return `${window.value}${window.unit}`
}
