export function getComputeQuantileCollapsePrompt(): string {
  return `
# ComputeQuantileCollapse Tool

Calculate quantile collapse rate to detect features with concentrated value distributions.

## Purpose
- Detect features where most values cluster in a narrow range
- Measure distribution spread using IQR (Interquartile Range)
- Support Gate 2 proxy evaluation in feature generation pipeline

## Key Metrics
- **Collapse Rate**: IQR / Range
  - Close to 0: Values highly concentrated (collapsed)
  - Close to 1: Values evenly distributed
- **IQR**: Q75 - Q25 (middle 50% spread)
- **Range**: Max - Min (total spread)
- **Status**:
  - collapsed: collapse_rate < 0.1 (90%+ values concentrated)
  - normal: collapse_rate >= 0.1

## Usage
\`\`\`typescript
await ComputeQuantileCollapse.call({
  datasource: 'credit_db',
  table: 'features',
  features: ['age', 'income', 'loan_amount']
})
\`\`\`

## Output
- Collapse rate for each feature
- Quantile values (Q25, Q75, min, max)
- IQR and range
- Status and recommendation

## Best Practices
- Only applicable to numeric features
- Collapse rate < 0.1 indicates poor distribution
- Combine with entropy and variance checks
- Features with collapsed distributions have low predictive power
`.trim()
}
