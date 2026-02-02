export function getComputeTemporalConsistencyPrompt(): string {
  return `
# ComputeTemporalConsistency Tool

Calculate temporal consistency by comparing feature distributions across different time windows.

## Purpose
- Detect features with unstable distributions over time
- Measure correlation between short and long time windows
- Support Gate 2 proxy evaluation in feature generation pipeline

## Key Metrics
- **Correlation**: Pearson correlation between short and long windows
  - Close to 1: Highly consistent
  - Close to 0: Inconsistent/unstable
- **Status**:
  - inconsistent: correlation < 0.3 (unstable over time)
  - consistent: correlation >= 0.3

## Usage
\`\`\`typescript
await ComputeTemporalConsistency.call({
  datasource: 'credit_db',
  table: 'features',
  features: ['age', 'income', 'loan_amount'],
  timeColumn: 'application_date',
  shortWindow: 30,  // 30 days
  longWindow: 60    // 60 days
})
\`\`\`

## Output
- Correlation between time windows
- Mean and std for each window
- Status and recommendation

## Best Practices
- Requires time-series data with timestamp column
- Short window: 30 days, Long window: 60 days (default)
- Correlation < 0.3 indicates unstable feature
- Unstable features may not generalize well
`.trim()
}
