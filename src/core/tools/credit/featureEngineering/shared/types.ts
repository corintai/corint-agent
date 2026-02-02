export type WindowUnit = 's' | 'm' | 'h' | 'd' | 'w' | 'mo' | 'y'

export type SubjectStability = 'high' | 'medium' | 'low'

export interface FeatureSubject {
  id: string
  name: string
  prefix: string
  type: string
  description?: string
  stability: SubjectStability
  max_window?: string
  allow_lifecycle?: boolean
  allow_network?: boolean
  allow_realtime?: boolean
}

export interface FeatureEvent {
  id: string
  name: string
}

export interface TimeWindowGroup {
  unit: WindowUnit
  values: number[]
  description?: string
}

export interface AggregationDefinition {
  id: string
  name: string
  description?: string
  sql_template?: string
  applicable_to?: string[]
  output_type?: string
  requires?: string[]
  algorithm?: string
  min_window?: string
  incompatible_metrics?: string[]
  period_type?: string
  weight_function?: string
}

export interface AggregationFamilies {
  basic?: AggregationDefinition[]
  ratio?: AggregationDefinition[]
  trend?: AggregationDefinition[]
  weighted?: AggregationDefinition[]
  lifecycle?: AggregationDefinition[]
  distribution?: AggregationDefinition[]
}

export interface CalculationMethod {
  id: string
  name: string
  description?: string
  prefix: string
}

export interface NamingConvention {
  template: string
  required: string[]
  optional: string[]
  separator: string
  max_length: number
  validation: { rule: string; description: string }[]
}

export interface FeatureConstraints {
  max_features?: number
  min_sample_size?: number
  feature_budget?: {
    total?: number
    per_subject?: Record<string, number>
    per_family?: Record<string, number>
    per_window?: Record<string, number>
  }
  selection?: Record<string, number>
  proxy_thresholds?: {
    max_missing_rate?: number
    min_variance?: number
    min_entropy?: number
    max_quantile_collapse?: number
    min_temporal_consistency?: number
  }
  business_rules?: { condition: string; reason: string; action: string }[]
  exclude_columns?: string[]
}

export interface FeaturePrimitives {
  version: string
  namespace?: string
  subjects: FeatureSubject[]
  time_windows: Record<string, TimeWindowGroup>
  events: FeatureEvent[]
  aggregations: AggregationFamilies
  calculation_methods: CalculationMethod[]
  naming_convention: NamingConvention
  constraints?: FeatureConstraints
  objects?: string[]
  dimensions?: string[]
}

export type FeatureFamily =
  | 'basic'
  | 'ratio'
  | 'trend'
  | 'weighted'
  | 'lifecycle'
  | 'distribution'
  | 'cross'
  | 'network'

export interface WindowSpec {
  value: number
  unit: WindowUnit
  label: string
  seconds: number
  group?: string
  groupType?: string
}

export interface FeatureCandidate {
  name: string
  subjectId: string
  subjectPrefix: string
  subjectStability?: SubjectStability
  calculation?: string
  metric: string
  object: string
  event?: string
  dimension?: string
  window: WindowSpec
  family: FeatureFamily
  windowGroup?: string
  windowGroupType?: string
}
