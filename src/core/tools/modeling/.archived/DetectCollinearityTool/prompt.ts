export function getDetectCollinearityPrompt(): string {
  return `
# DetectCollinearity Tool

Detect highly correlated feature pairs to reduce redundancy and multicollinearity.

## Purpose
- Identify redundant features with high correlation
- Reduce feature dimensionality
- Improve model interpretability and stability
- Support feature selection in modeling pipeline

## Key Metrics
- **Correlation**: Pearson correlation coefficient
  - |r| > 0.8: High collinearity (default threshold)
  - |r| > 0.95: Very high collinearity
- **Recommendation**:
  - keep_feature1: Keep first feature, drop second
  - keep_feature2: Keep second feature, drop first
  - review: Manual review needed

## Usage
\`\`\`typescript
await DetectCollinearity.call({
  datasource: 'credit_db',
  table: 'features',
  features: ['age', 'income', 'loan_amount'],
  threshold: 0.8  // Correlation threshold
})
\`\`\`

## Output
- Collinear feature pairs
- Correlation values
- Recommendations for which feature to keep
- Summary statistics

## Best Practices
- Use threshold 0.8 for general feature selection
- Use threshold 0.95 for strict redundancy removal
- Consider feature importance when choosing which to keep
- Review domain knowledge before dropping features
`.trim()
}
