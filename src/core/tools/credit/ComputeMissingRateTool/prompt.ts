export function getComputeMissingRatePrompt(): string {
  return `Calculate missing value rates for dataset columns with optional grouping.

This tool analyzes missing values and provides:
- Missing rate for each column (percentage and count)
- Status classification (good/warning/critical)
- Optional grouping by time period or category
- Summary statistics

Missing value detection:
- Null and undefined values
- Empty strings
- Special values: "null", "N/A", "NA"
- NaN and Infinity for numeric columns

Status thresholds:
- Good: missing rate < 5%
- Warning: 5% ≤ missing rate < 30%
- Critical: missing rate ≥ 30%

Use this tool for:
- Data quality monitoring
- Feature selection (drop high-missing features)
- Temporal missing pattern detection
- Segment-specific data quality analysis

Example usage:
- All columns: { datasource: "credit_db", table: "applications" }
- Specific columns: { datasource: "credit_db", table: "applications", columns: ["income", "credit_score"] }
- With grouping: { datasource: "credit_db", table: "applications", groupBy: "application_date" }`
}
