import { readFile } from 'fs/promises'
import path from 'path'
import yaml from 'js-yaml'
import type {
  AggregationDefinition,
  FeaturePrimitives,
  FeatureSubject,
} from './types'
import { getAllWindows, parseWindowLabel } from './windows'

export interface LoadedPrimitives {
  primitives: FeaturePrimitives
  subjectsById: Record<string, FeatureSubject>
  subjectsByPrefix: Record<string, FeatureSubject>
  aggregationsById: Record<string, AggregationDefinition>
  aggregationsByFamily: Record<string, AggregationDefinition[]>
  calculationMethodsByPrefix: Record<string, string>
  windows: ReturnType<typeof getAllWindows>
}

export async function loadPrimitives(
  primitivesPath?: string,
): Promise<LoadedPrimitives> {
  const resolvedPath = resolvePrimitivesPath(primitivesPath)
  const raw = await readFile(resolvedPath, 'utf-8')
  const parsed = yaml.load(raw) as FeaturePrimitives

  const subjectsById: Record<string, FeatureSubject> = {}
  const subjectsByPrefix: Record<string, FeatureSubject> = {}
  parsed.subjects.forEach(subject => {
    subjectsById[subject.id] = subject
    subjectsByPrefix[subject.prefix] = subject
  })

  const aggregationsByFamily: Record<string, AggregationDefinition[]> = {}
  const aggregationsById: Record<string, AggregationDefinition> = {}
  for (const [family, list] of Object.entries(parsed.aggregations || {})) {
    aggregationsByFamily[family] = list || []
    for (const agg of list || []) {
      aggregationsById[agg.id] = agg
    }
  }

  const calculationMethodsByPrefix: Record<string, string> = {}
  parsed.calculation_methods?.forEach(method => {
    calculationMethodsByPrefix[method.prefix] = method.id
  })

  const windows = getAllWindows(parsed.time_windows || {})

  return {
    primitives: parsed,
    subjectsById,
    subjectsByPrefix,
    aggregationsById,
    aggregationsByFamily,
    calculationMethodsByPrefix,
    windows,
  }
}

export function resolvePrimitivesPath(primitivesPath?: string): string {
  if (primitivesPath) {
    return path.isAbsolute(primitivesPath)
      ? primitivesPath
      : path.join(process.cwd(), primitivesPath)
  }
  return path.join(process.cwd(), 'docs', 'feature_primitives.yaml')
}

export function parseWindowLimit(limit?: string): number | null {
  if (!limit) return null
  const parsed = parseWindowLabel(limit)
  return parsed ? parsed.seconds : null
}
