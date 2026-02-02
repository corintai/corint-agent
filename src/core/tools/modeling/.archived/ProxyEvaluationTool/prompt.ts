export function getProxyEvaluationPrompt(): string {
  return `
# ProxyEvaluationTool (Gate 2)

Quickly evaluate feature candidate quality on small samples to filter out low-quality features.

## Purpose
- Avoid full computation of all candidate features
- Use proxy metrics to quickly assess feature value
- Filter obviously useless features before investing computation

## Workflow

### 1. Preparation
Input:
- primitives: Feature primitives configuration
- candidates: Candidate features that passed Gate 1 semantic pruning
- samplingStrategy: Sampling strategy (random/time window/top-N subjects)

### 2. Small Sample Computation
For each candidate feature:
- Sample 1-5% of data or recent 30/60 days
- Compute proxy metrics (no need to compute full features)

### 3. Invoke Data Analysis Tools
Call the following tools in parallel to evaluate feature quality:

\`\`\`typescript
// 3.1 Compute missing rate
const missingRate = await ComputeMissingRate.call({
  datasource: 'credit_db',
  table: 'sampled_data',
  features: candidateFeatures
})

// 3.2 Compute variance (detect constant features)
const variance = await ComputeVariance.call({
  datasource: 'credit_db',
  table: 'sampled_data',
  features: candidateFeatures,
  threshold: 1e-6
})

// 3.3 Compute entropy (detect information content)
const entropy = await ComputeEntropy.call({
  datasource: 'credit_db',
  table: 'sampled_data',
  features: candidateFeatures,
  threshold: 1.0
})

// 3.4 Compute quantile collapse (detect distribution concentration)
const quantileCollapse = await ComputeQuantileCollapse.call({
  datasource: 'credit_db',
  table: 'sampled_data',
  features: candidateFeatures,
  threshold: 0.1
})

// 3.5 Compute temporal consistency (detect stability)
const temporalConsistency = await ComputeTemporalConsistency.call({
  datasource: 'credit_db',
  table: 'sampled_data',
  features: candidateFeatures,
  timeColumn: 'application_date',
  shortWindow: 30,
  longWindow: 60,
  threshold: 0.3
})

// 3.6 Detect collinearity (detect redundant features)
const collinearity = await DetectCollinearity.call({
  datasource: 'credit_db',
  table: 'sampled_data',
  features: candidateFeatures,
  threshold: 0.8
})
\`\`\`

### 4. Comprehensive Scoring and Filtering
Filter low-quality features based on proxy metrics:

**Rejection Rules**:
- Missing rate > 80% → Reject
- Variance < 1e-6 → Reject (constant)
- Entropy < 1.0 → Reject (low information)
- Quantile collapse > 90% → Reject (concentrated distribution)
- Temporal consistency < 30% → Reject (unstable)
- Correlation with selected features > 0.8 → Reject (redundant)

**Retention Rules**:
- Pass all threshold checks
- Rank by composite score, keep Top-K

### 5. Output
Returns:
- passed: Candidate features that passed evaluation
- rejected: Rejected features with reasons
- proxyScores: Proxy metric scores for each feature
- summary: Statistical summary

## Efficiency Gain
- Input: 50,000 candidates (Gate 1 output)
- Output: 5,000 candidates (90% pruned)
- Cost: 1-5% computation (small sample)

## Usage Example

\`\`\`typescript
const evaluated = await ProxyEvaluationTool.call({
  primitives: primitives,
  candidates: prunedCandidates,
  samplingStrategy: {
    method: 'random',
    sampleRate: 0.05  // 5% sampling
  },
  thresholds: {
    missingRate: 0.8,
    variance: 1e-6,
    entropy: 1.0,
    quantileCollapse: 0.9,
    temporalConsistency: 0.3,
    correlation: 0.8
  }
})

console.log(\`Passed: \${evaluated.passed.length}\`)
console.log(\`Rejected: \${evaluated.rejected.length}\`)
\`\`\`

## Notes
- Proxy evaluation is not final evaluation, just quick filtering
- Small sample results may be biased, but sufficient to eliminate obviously useless features
- Features passing Gate 2 still need further filtering in Gate 3
`.trim()
}
