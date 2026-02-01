export function getProfileDatasetPrompt(): string {
  return `Generate comprehensive dataset profile including statistics and data quality metrics.

This tool analyzes a dataset and provides:
- Row and column counts
- Column data types (numeric, categorical, datetime, text)
- Missing value rates
- Basic statistics (min, max, mean, median, std for numeric columns)
- Top values for categorical columns
- Memory usage estimation

Use this tool for:
- Initial data exploration
- Data quality assessment
- Feature type identification
- Understanding data distribution

Guidelines:
- For large datasets (>10K rows), automatic sampling is applied
- Numeric columns: columns with >80% numeric values
- Categorical columns: columns with <50% unique values
- Missing values include null, empty strings, NaN, Inf

Example usage:
- Profile database table: { datasource: "credit_db", table: "loan_applications" }
- Profile local CSV: { filePath: "/path/to/data.csv" }
- Profile with sampling: { datasource: "credit_db", table: "large_table", sampleSize: 50000 }`
}
