export function getComputeVariancePrompt(): string {
  return `
# ComputeVariance Tool

Calculate variance and standard deviation for numeric features to identify low-variance or constant features.

## Purpose
- Detect features with low information content (near-constant values)
- Support Gate 2 proxy evaluation in feature generation pipeline
- Quick filter before expensive feature computation

## Key Metrics
- **Variance**: Measure of data spread (σ²)
- **Standard Deviation**: Square root of variance (σ)
- **Status**:
  - constant: variance < 1e-6 (effectively constant)
  - low_variance: variance < 0.01 (very low information)
  - normal: variance >= 0.01

## Usage
\`\`\`typescript
await ComputeVariance.call({
  datasource: 'credit_db',
  table: 'features',
  features: ['age', 'income', 'loan_amount']
})
\`\`\`

## Output
- Variance and std for each feature
- Status classification
- Recommendation (keep/review/drop)
- Summary statistics

## Best Practices
- Use on numeric features only
- Threshold (1e-6) filters out constants
- Low variance features (< 0.01) should be reviewed
- Combine with other quality checks (missing rate, coverage)
`.trim()
}
