export function getDetectSingleValuePrompt(): string {
  return `Detect features with single dominant value (low variance) that provide no predictive power.

Single-value features are columns where one value dominates (e.g., 95%+ of rows have the same value). These features:
- Provide no predictive power
- Waste computational resources
- Can cause numerical instability
- Should be removed before modeling

Detection Logic:
- If dominant value rate ≥ threshold (default 95%), flag as single-value
- recommendation = 'drop' if rate ≥ 99%
- recommendation = 'review' if 95% ≤ rate < 99%

Use this tool for:
- Feature selection (remove zero-variance features)
- Data quality check
- Model training preparation
- Feature engineering validation

Guidelines:
- Default threshold: 95% (adjustable)
- Always drop features with 99%+ single value
- Review features with 95-99% single value (may be valid in some cases)
- Check if single value is meaningful (e.g., all approved loans)

Example usage:
- Check all columns: { datasource: "credit_db", table: "applications" }
- Specific features: { filePath: "data.csv", features: ["status", "flag"], threshold: 0.95 }
- Strict threshold: { datasource: "credit_db", table: "features", threshold: 0.99 }`
}
