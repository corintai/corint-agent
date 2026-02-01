# Credit Modeling Tools Design

## Overview

This document describes the design of credit modeling tools for CORINT Risk Agent. These tools provide fine-grained, composable operations for data profiling, feature analysis, and model monitoring in credit risk scenarios.

## Design Philosophy

**Core Principles**:
1. **Fine-grained operations** - Each tool performs a single, well-defined task
2. **Composability** - Tools can be chained together for complex workflows
3. **Data-driven** - All metrics and thresholds are computed from actual data
4. **Reusability** - Tools work with multiple data sources (SQL databases, local files)

## Tool Categories

### Data Layer Tools
Tools for data quality assessment and stability monitoring:
- `ProfileDatasetTool` - Dataset profiling and statistics
- `ComputeMissingRateTool` - Missing value analysis
- `ComputePsiTool` - Population Stability Index calculation

### Feature Layer Tools
Tools for feature engineering and selection:
- `ComputeIvTool` - Information Value calculation
- `ComputeCoverageTool` - Feature coverage analysis
- `DetectSingleValueTool` - Single-value feature detection

## Tool Specifications

### 1. ProfileDatasetTool

**Purpose**: Generate comprehensive dataset profile including row/column counts, data types, distributions, and basic statistics.

**Input Schema**:
```typescript
{
  datasource: string           // Data source name (from datasource.yaml)
  table?: string               // Table name (for SQL sources)
  filePath?: string            // File path (for local files: CSV, Parquet, Excel)
  sampleSize?: number          // Sample size for large datasets (default: 10000)
}
```

**Output**:
```typescript
{
  rowCount: number,
  columnCount: number,
  columns: [{
    name: string,
    type: string,              // 'numeric' | 'categorical' | 'datetime' | 'text'
    uniqueCount: number,
    missingRate: number,
    // For numeric columns
    min?: number,
    max?: number,
    mean?: number,
    median?: number,
    std?: number,
    // For categorical columns
    topValues?: { value: any, count: number, percentage: number }[]
  }],
  memoryUsage: string,
  samplingApplied: boolean
}
```

**Use Cases**:
- Initial data exploration
- Data quality assessment
- Feature type identification
- Memory usage estimation

---

### 2. ComputeMissingRateTool

**Purpose**: Calculate missing value rates for specified columns, with optional grouping for temporal or segmented analysis.

**Input Schema**:
```typescript
{
  datasource: string,
  table?: string,
  filePath?: string,
  columns?: string[]           // Specific columns to analyze (default: all)
  groupBy?: string             // Group by field (e.g., 'date', 'region')
}
```

**Output**:
```typescript
{
  overall: [{
    column: string,
    missingRate: number,       // 0.0 to 1.0
    missingCount: number,
    totalCount: number,
    status: 'good' | 'warning' | 'critical'  // Based on thresholds
  }],
  byGroup?: [{
    group: string,
    missingRates: Record<string, number>
  }],
  summary: {
    avgMissingRate: number,
    highMissingColumns: string[]  // Columns with >50% missing
  }
}
```

**Thresholds**:
- `good`: missing rate < 5%
- `warning`: 5% ≤ missing rate < 30%
- `critical`: missing rate ≥ 30%

**Use Cases**:
- Data quality monitoring
- Feature selection (drop high-missing features)
- Temporal missing pattern detection
- Segment-specific data quality analysis

---

### 3. ComputePsiTool

**Purpose**: Calculate Population Stability Index (PSI) to detect distribution drift between baseline and current datasets.

**Input Schema**:
```typescript
{
  baselineData: string,        // Baseline data source/file path
  currentData: string,         // Current data source/file path
  columns: string[],           // Columns to compute PSI
  bins?: number,               // Number of bins (default: 10)
  method?: 'quantile' | 'equal_width'  // Binning method (default: 'quantile')
}
```

**Output**:
```typescript
{
  psi: [{
    column: string,
    psiValue: number,
    status: 'stable' | 'warning' | 'drift',
    interpretation: string
  }],
  details: [{
    column: string,
    bins: [{
      range: string,           // e.g., "(-inf, 100]"
      baselinePct: number,     // Percentage in baseline
      currentPct: number,      // Percentage in current
      contribution: number     // Contribution to total PSI
    }]
  }],
  summary: {
    totalColumns: number,
    stableCount: number,
    driftCount: number,
    maxPsi: number,
    maxPsiColumn: string
  }
}
```

**PSI Interpretation**:
- `PSI < 0.1`: Stable (no significant change)
- `0.1 ≤ PSI < 0.25`: Warning (moderate change, investigate)
- `PSI ≥ 0.25`: Drift (significant change, model may need retraining)

**Formula**:
```
PSI = Σ (Current% - Baseline%) × ln(Current% / Baseline%)
```

**Use Cases**:
- Model monitoring (detect data drift)
- Feature stability tracking
- A/B test validation
- Production vs training data comparison

---

### 4. ComputeIvTool

**Purpose**: Calculate Information Value (IV) and Weight of Evidence (WOE) for feature selection in binary classification.

**Input Schema**:
```typescript
{
  datasource: string,
  table?: string,
  filePath?: string,
  features: string[],          // Feature column names
  target: string,              // Target variable (must be binary: 0/1)
  bins?: number,               // Number of bins (default: 10)
  method?: 'quantile' | 'equal_width' | 'tree'  // Binning method (default: 'quantile')
}
```

**Output**:
```typescript
{
  iv: [{
    feature: string,
    ivValue: number,
    predictivePower: 'weak' | 'medium' | 'strong' | 'suspicious',
    recommendation: string
  }],
  woe: [{
    feature: string,
    bins: [{
      range: string,
      woe: number,             // Weight of Evidence
      iv: number,              // IV contribution
      goodCount: number,       // Count of target=0
      badCount: number,        // Count of target=1
      goodRate: number,        // Good rate in bin
      badRate: number          // Bad rate in bin
    }]
  }],
  summary: {
    totalFeatures: number,
    strongFeatures: string[],
    weakFeatures: string[],
    suspiciousFeatures: string[],
    skippedFeatures: string[],   // Missing or non-numeric features
    skippedDetails: {            // Skipped feature reasons
      feature: string,
      reason: 'missing' | 'no_valid_rows' | 'no_bins'
    }[]
  }
}
```

**IV Interpretation**:
- `IV < 0.02`: Weak (not predictive)
- `0.02 ≤ IV < 0.1`: Medium (weak predictive power)
- `0.1 ≤ IV < 0.3`: Strong (medium predictive power)
- `0.3 ≤ IV < 0.5`: Strong (strong predictive power)
- `IV ≥ 0.5`: Suspicious (too good to be true, check for data leakage)

**Formula**:
```
WOE = ln(Good% / Bad%)
IV = Σ (Good% - Bad%) × WOE
```

**Use Cases**:
- Feature selection for credit scoring models
- Identify data leakage (suspicious IV)
- Understand feature-target relationship
- Generate scorecard binning

---

### 5. ComputeCoverageTool

**Purpose**: Calculate feature coverage rate (non-null, non-empty values) to assess feature availability.

**Input Schema**:
```typescript
{
  datasource: string,
  table?: string,
  filePath?: string,
  features: string[],          // Feature column names
  threshold?: number           // Non-null threshold (default: 0.0)
}
```

**Output**:
```typescript
{
  coverage: [{
    feature: string,
    coverageRate: number,      // 0.0 to 1.0
    validCount: number,        // Count of valid values
    totalCount: number,
    status: 'good' | 'warning' | 'poor',
    recommendation: string
  }],
  summary: {
    avgCoverage: number,
    lowCoverageFeatures: string[],  // Coverage < 70%
    goodCoverageCount: number,
    poorCoverageCount: number
  }
}
```

**Coverage Thresholds**:
- `good`: coverage ≥ 90%
- `warning`: 70% ≤ coverage < 90%
- `poor`: coverage < 70%

**Validation Rules**:
- Null values are considered invalid
- Empty strings are considered invalid
- For numeric columns: NaN, Inf, -Inf are invalid
- For categorical columns: empty strings, "null", "N/A" are invalid

**Use Cases**:
- Feature availability assessment
- Feature selection (drop low-coverage features)
- Data source quality comparison
- Production readiness check

---

### 6. DetectSingleValueTool

**Purpose**: Detect features with single dominant value (low variance), which provide no predictive power.

**Input Schema**:
```typescript
{
  datasource: string,
  table?: string,
  filePath?: string,
  features?: string[],         // Specific features (default: all columns)
  threshold?: number           // Dominant value threshold (default: 0.95)
}
```

**Output**:
```typescript
{
  singleValueFeatures: [{
    feature: string,
    dominantValue: any,        // The dominant value
    dominantRate: number,      // Percentage of dominant value
    uniqueCount: number,       // Total unique values
    recommendation: 'drop' | 'review',
    reason: string
  }],
  summary: {
    totalChecked: number,
    singleValueCount: number,
    recommendDrop: string[],
    recommendReview: string[]
  }
}
```

**Detection Logic**:
- If `dominantRate ≥ threshold` (default 95%), flag as single-value
- `recommendation = 'drop'` if `dominantRate ≥ 0.99`
- `recommendation = 'review'` if `0.95 ≤ dominantRate < 0.99`

**Use Cases**:
- Feature selection (remove zero-variance features)
- Data quality check
- Model training preparation
- Feature engineering validation

---

## Implementation Architecture

### File Structure

```
src/core/tools/credit/
├── ProfileDatasetTool/
│   ├── ProfileDatasetTool.tsx
│   ├── prompt.ts
│   └── types.ts
├── ComputeMissingRateTool/
│   ├── ComputeMissingRateTool.tsx
│   ├── prompt.ts
│   └── types.ts
├── ComputePsiTool/
│   ├── ComputePsiTool.tsx
│   ├── prompt.ts
│   └── types.ts
├── ComputeIvTool/
│   ├── ComputeIvTool.tsx
│   ├── prompt.ts
│   └── types.ts
├── ComputeCoverageTool/
│   ├── ComputeCoverageTool.tsx
│   ├── prompt.ts
│   └── types.ts
├── DetectSingleValueTool/
│   ├── DetectSingleValueTool.tsx
│   ├── prompt.ts
│   └── types.ts
└── shared/
    ├── binning.ts           // Binning algorithms
    ├── statistics.ts        // Statistical functions
    └── validation.ts        // Input validation
```

### Tool Registration

```typescript
// src/core/tools/tools-index.ts
import { ProfileDatasetTool } from './credit/ProfileDatasetTool/ProfileDatasetTool'
import { ComputeMissingRateTool } from './credit/ComputeMissingRateTool/ComputeMissingRateTool'
import { ComputePsiTool } from './credit/ComputePsiTool/ComputePsiTool'
import { ComputeIvTool } from './credit/ComputeIvTool/ComputeIvTool'
import { ComputeCoverageTool } from './credit/ComputeCoverageTool/ComputeCoverageTool'
import { DetectSingleValueTool } from './credit/DetectSingleValueTool/DetectSingleValueTool'

export const getAllTools = (): Tool[] => [
  // ... existing tools
  ProfileDatasetTool,
  ComputeMissingRateTool,
  ComputePsiTool,
  ComputeIvTool,
  ComputeCoverageTool,
  DetectSingleValueTool,
]
```

### Data Source Integration

All tools support multiple data sources through the existing `DataSourceService`:

```typescript
// Supported data sources
type DataSourceType = 'postgres' | 'mysql' | 'clickhouse' | 'sqlite' | 'databricks'

// Local file formats
type FileFormat = 'csv' | 'parquet' | 'excel'

// Tool implementation pattern
async function loadData(params: {
  datasource?: string,
  table?: string,
  filePath?: string
}): Promise<DataFrame> {
  if (params.filePath) {
    // Load from local file
    return await loadLocalFile(params.filePath)
  } else if (params.datasource && params.table) {
    // Load from database
    const ds = await getDataSource(params.datasource)
    return await ds.query(`SELECT * FROM ${params.table}`)
  } else {
    throw new Error('Must provide either filePath or (datasource + table)')
  }
}
```

### Dependencies

**Required Libraries**:
- `duckdb-node` - In-memory SQL engine for data processing (already in project)
- `apache-arrow` - Columnar data format for efficient processing
- `simple-statistics` - Statistical calculations (quantiles, mean, std)
- `mathjs` - Mathematical operations

**Optional Libraries**:
- `d3-array` - Advanced binning algorithms
- `plotly.js` - Visualization generation (for reports)

### Shared Utilities

#### Binning Algorithm (`shared/binning.ts`)

```typescript
export interface BinningOptions {
  method: 'quantile' | 'equal_width' | 'tree'
  bins: number
}

export interface Bin {
  range: string
  min: number
  max: number
  count: number
  percentage: number
}

export function createBins(
  values: number[],
  options: BinningOptions
): Bin[] {
  switch (options.method) {
    case 'quantile':
      return quantileBinning(values, options.bins)
    case 'equal_width':
      return equalWidthBinning(values, options.bins)
    case 'tree':
      return treeBinning(values, options.bins)
  }
}
```

#### Statistical Functions (`shared/statistics.ts`)

```typescript
export function computePSI(
  baseline: number[],
  current: number[],
  bins: Bin[]
): number {
  let psi = 0
  for (const bin of bins) {
    const baselinePct = countInBin(baseline, bin) / baseline.length
    const currentPct = countInBin(current, bin) / current.length

    if (baselinePct > 0 && currentPct > 0) {
      psi += (currentPct - baselinePct) * Math.log(currentPct / baselinePct)
    }
  }
  return psi
}

export function computeIV(
  feature: number[],
  target: number[],
  bins: Bin[]
): { iv: number, woe: number[] } {
  let totalIV = 0
  const woeValues: number[] = []

  const totalGood = target.filter(t => t === 0).length
  const totalBad = target.filter(t => t === 1).length

  for (const bin of bins) {
    const indices = getIndicesInBin(feature, bin)
    const goodCount = indices.filter(i => target[i] === 0).length
    const badCount = indices.filter(i => target[i] === 1).length

    const goodPct = goodCount / totalGood
    const badPct = badCount / totalBad

    if (goodPct > 0 && badPct > 0) {
      const woe = Math.log(goodPct / badPct)
      const iv = (goodPct - badPct) * woe
      totalIV += iv
      woeValues.push(woe)
    }
  }

  return { iv: totalIV, woe: woeValues }
}
```

---

## Usage Examples

### Example 1: Data Quality Assessment

```typescript
// Step 1: Profile dataset
const profile = await ProfileDatasetTool.call({
  datasource: 'credit_db',
  table: 'loan_applications',
  sampleSize: 50000
})

// Step 2: Check missing rates
const missingRates = await ComputeMissingRateTool.call({
  datasource: 'credit_db',
  table: 'loan_applications',
  groupBy: 'application_date'
})

// Step 3: Detect single-value features
const singleValues = await DetectSingleValueTool.call({
  datasource: 'credit_db',
  table: 'loan_applications',
  threshold: 0.95
})

// Decision: Drop features with high missing rate or single value
const featuresToDrop = [
  ...missingRates.summary.highMissingColumns,
  ...singleValues.summary.recommendDrop
]
```

### Example 2: Feature Selection for Credit Scoring

```typescript
// Step 1: Compute IV for all features
const ivResults = await ComputeIvTool.call({
  datasource: 'credit_db',
  table: 'loan_applications',
  features: ['credit_score', 'income', 'debt_ratio', 'age', 'employment_years'],
  target: 'default_flag',
  bins: 10,
  method: 'quantile'
})

// Step 2: Check feature coverage
const coverage = await ComputeCoverageTool.call({
  datasource: 'credit_db',
  table: 'loan_applications',
  features: ivResults.summary.strongFeatures
})

// Decision: Select features with strong IV and good coverage
const selectedFeatures = ivResults.summary.strongFeatures.filter(f => {
  const featureCoverage = coverage.coverage.find(c => c.feature === f)
  return featureCoverage && featureCoverage.coverageRate >= 0.9
})
```

### Example 3: Model Monitoring

```typescript
// Step 1: Compute PSI for all features
const psiResults = await ComputePsiTool.call({
  baselineData: 'credit_db.training_data',
  currentData: 'credit_db.production_data_2024_01',
  columns: ['credit_score', 'income', 'debt_ratio'],
  bins: 10,
  method: 'quantile'
})

// Step 2: Check for drift
const driftedFeatures = psiResults.psi.filter(p => p.status === 'drift')

if (driftedFeatures.length > 0) {
  console.log('⚠️ Model drift detected!')
  console.log('Drifted features:', driftedFeatures.map(f => f.column))
  console.log('Recommendation: Retrain model or investigate data changes')
}
```

### Example 4: Workflow Composition

```typescript
// Complete credit modeling workflow
async function creditModelingWorkflow(datasource: string, table: string) {
  // 1. Data profiling
  const profile = await ProfileDatasetTool.call({ datasource, table })

  // 2. Data quality checks
  const [missingRates, singleValues] = await Promise.all([
    ComputeMissingRateTool.call({ datasource, table }),
    DetectSingleValueTool.call({ datasource, table })
  ])

  // 3. Feature selection
  const allFeatures = profile.columns
    .filter(c => c.type === 'numeric')
    .map(c => c.name)

  const cleanFeatures = allFeatures.filter(f =>
    !missingRates.summary.highMissingColumns.includes(f) &&
    !singleValues.summary.recommendDrop.includes(f)
  )

  // 4. IV calculation
  const ivResults = await ComputeIvTool.call({
    datasource,
    table,
    features: cleanFeatures,
    target: 'default_flag'
  })

  // 5. Coverage check
  const coverage = await ComputeCoverageTool.call({
    datasource,
    table,
    features: ivResults.summary.strongFeatures
  })

  // 6. Final feature selection
  const finalFeatures = ivResults.summary.strongFeatures.filter(f => {
    const cov = coverage.coverage.find(c => c.feature === f)
    return cov && cov.status === 'good'
  })

  return {
    profile,
    dataQuality: { missingRates, singleValues },
    featureSelection: { ivResults, coverage },
    finalFeatures
  }
}
```

---

## Integration with RDL Generation

Credit modeling tools can be used to inform RDL rule generation:

```typescript
// Example: Generate credit approval rule based on IV analysis
async function generateCreditRule(datasource: string, table: string) {
  // 1. Analyze features
  const ivResults = await ComputeIvTool.call({
    datasource,
    table,
    features: ['credit_score', 'income', 'debt_ratio'],
    target: 'default_flag'
  })

  // 2. Extract optimal thresholds from WOE bins
  const thresholds = ivResults.woe.map(w => ({
    feature: w.feature,
    threshold: w.bins.find(b => b.woe > 0)?.range.split(',')[0]
  }))

  // 3. Build analysis context for RDL generator
  const context = {
    insights: {
      metrics: { iv: ivResults.iv },
      thresholds: thresholds
    },
    constraints: {
      regulatory: ['Fair Lending Act'],
      business: { minApprovalRate: 0.6 }
    }
  }

  // 4. Spawn RDL generator sub agent
  const result = await spawnAgent('rdl-generator', {
    mode: 'create',
    ruleName: 'credit_approval',
    context: context
  })

  return result
}
```

---

## Performance Considerations

### Data Sampling Strategy

For large datasets (>1M rows), automatic sampling is applied:

```typescript
function determineSampleSize(totalRows: number): number {
  if (totalRows <= 100000) return totalRows
  if (totalRows <= 1000000) return 100000
  if (totalRows <= 10000000) return 500000
  return 1000000  // Max 1M rows
}
```

### Caching Strategy

Computed results can be cached to avoid redundant calculations:

```typescript
interface CacheKey {
  tool: string
  datasource: string
  table: string
  params: Record<string, any>
}

// Cache TTL: 1 hour for data quality metrics
// Cache TTL: 24 hours for IV/PSI calculations
```

### Parallel Execution

Independent tool calls should be executed in parallel:

```typescript
// Good: Parallel execution
const [profile, missing, single] = await Promise.all([
  ProfileDatasetTool.call({ datasource, table }),
  ComputeMissingRateTool.call({ datasource, table }),
  DetectSingleValueTool.call({ datasource, table })
])

// Bad: Sequential execution
const profile = await ProfileDatasetTool.call({ datasource, table })
const missing = await ComputeMissingRateTool.call({ datasource, table })
const single = await DetectSingleValueTool.call({ datasource, table })
```

---

## Error Handling

### Input Validation

```typescript
// Validate data source exists
if (!datasource && !filePath) {
  throw new Error('Must provide either datasource or filePath')
}

// Validate target variable for IV calculation
const uniqueTargetValues = [...new Set(target)]
if (uniqueTargetValues.length !== 2 || !uniqueTargetValues.includes(0) || !uniqueTargetValues.includes(1)) {
  throw new Error('Target variable must be binary (0/1)')
}

// Validate binning parameters
if (bins < 2 || bins > 100) {
  throw new Error('Number of bins must be between 2 and 100')
}
```

### Graceful Degradation

```typescript
// Handle missing data gracefully
try {
  const ivResult = await ComputeIvTool.call({ ... })
} catch (error) {
  if (error.message.includes('insufficient data')) {
    console.warn('⚠️ Insufficient data for IV calculation, skipping feature')
    return { iv: 0, predictivePower: 'unknown' }
  }
  throw error
}
```

---

## Testing Strategy

### Unit Tests

```typescript
describe('ComputeIvTool', () => {
  it('should calculate IV correctly for binary target', async () => {
    const result = await ComputeIvTool.call({
      filePath: 'test/fixtures/credit_data.csv',
      features: ['credit_score'],
      target: 'default_flag',
      bins: 5
    })

    expect(result.iv[0].ivValue).toBeGreaterThan(0)
    expect(result.iv[0].predictivePower).toBe('strong')
  })

  it('should detect suspicious IV (data leakage)', async () => {
    const result = await ComputeIvTool.call({
      filePath: 'test/fixtures/leakage_data.csv',
      features: ['leaked_feature'],
      target: 'default_flag'
    })

    expect(result.iv[0].predictivePower).toBe('suspicious')
  })
})
```

### Integration Tests

```typescript
describe('Credit Modeling Workflow', () => {
  it('should complete end-to-end feature selection', async () => {
    const result = await creditModelingWorkflow('test_db', 'loan_applications')

    expect(result.finalFeatures.length).toBeGreaterThan(0)
    expect(result.dataQuality.missingRates.summary.avgMissingRate).toBeLessThan(0.1)
  })
})
```

---

## Implementation Priority

### Phase 1: Foundation (Week 1-2)
- [x] Tool interface design
- [ ] Shared utilities (binning, statistics)
- [ ] Data source integration
- [ ] ProfileDatasetTool implementation
- [ ] ComputeMissingRateTool implementation

### Phase 2: Feature Analysis (Week 3-4)
- [ ] ComputeIvTool implementation
- [ ] ComputeCoverageTool implementation
- [ ] DetectSingleValueTool implementation
- [ ] Unit tests for all tools

### Phase 3: Model Monitoring (Week 5-6)
- [ ] ComputePsiTool implementation
- [ ] Integration tests
- [ ] Performance optimization (sampling, caching)
- [ ] Documentation and examples

### Phase 4: Integration (Week 7-8)
- [ ] RDL generation integration
- [ ] Workflow composition utilities
- [ ] CLI commands for common workflows
- [ ] Production deployment

---

## References

- **Information Value**: [Naeem Siddiqi, "Credit Risk Scorecards"](https://www.wiley.com/en-us/Credit+Risk+Scorecards%3A+Developing+and+Implementing+Intelligent+Credit+Scoring-p-9780471754510)
- **PSI Calculation**: [Yurdakul, "Statistical Properties of Population Stability Index"](https://scholarworks.wmich.edu/dissertations/3208/)
- **WOE Binning**: [Anderson, "The Credit Scoring Toolkit"](https://global.oup.com/academic/product/the-credit-scoring-toolkit-9780199226405)
- **Data Source Integration**: `src/core/services/datasource/types.ts`
- **Tool Architecture**: `src/core/tools/tool.ts`
- **RDL Generation**: `docs/RDL_GENERATION.md`

---

**Document Version**: 1.0
**Last Updated**: 2026-01-29
**Status**: Design Phase
