export function getComputeEntropyPrompt(): string {
  return `
# ComputeEntropy Tool

Calculate Shannon entropy to measure information content and distribution uniformity of features.

## Purpose
- Measure feature information content
- Detect features with concentrated distributions (low entropy)
- Support Gate 2 proxy evaluation in feature generation pipeline

## Key Metrics
- **Entropy**: H = -Σ(p_i * log2(p_i))
  - 0: All values are the same (no information)
  - High: Values are uniformly distributed (high information)
- **Status**:
  - low_entropy: entropy < 1.0 (concentrated distribution)
  - normal: entropy >= 1.0

## Usage
\`\`\`typescript
await ComputeEntropy.call({
  datasource: 'credit_db',
  table: 'features',
  features: ['age', 'income', 'loan_amount'],
  bins: 10  // Number of bins for numeric features
})
\`\`\`

## Output
- Entropy value for each feature
- Number of bins used
- Unique value count
- Status and recommendation

## Best Practices
- Use 10 bins for numeric features (default)
- Entropy < 1.0 indicates low information content
- Combine with variance check for comprehensive quality assessment
- Categorical features use actual unique values (no binning)
`.trim()
}
