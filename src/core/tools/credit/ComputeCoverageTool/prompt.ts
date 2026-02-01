export function getComputeCoveragePrompt(): string {
  return `Calculate feature coverage rate (non-null, non-empty values) to assess feature availability.

Coverage measures the percentage of valid (non-missing) values in a feature. High coverage is essential for reliable modeling.

Coverage Thresholds:
- Good: coverage ≥ 90%
- Warning: 70% ≤ coverage < 90%
- Poor: coverage < 70%

Invalid Values:
- Null and undefined
- Empty strings
- Special values: "null", "N/A", "NA"
- NaN, Infinity, -Infinity for numeric columns

Use this tool for:
- Feature availability assessment
- Feature selection (drop low-coverage features)
- Data source quality comparison
- Production readiness check

Guidelines:
- Features with <70% coverage should be investigated
- Consider imputation for features with 70-90% coverage
- Drop features with <50% coverage unless critical
- Check coverage trends over time

Example usage:
- Basic coverage: { datasource: "credit_db", table: "applications", features: ["income", "credit_score", "employment_years"] }
- Local file: { filePath: "data.csv", features: ["age", "debt_ratio"] }`
}
