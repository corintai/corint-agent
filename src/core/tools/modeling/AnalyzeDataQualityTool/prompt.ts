export function getAnalyzeDataQualityPrompt(): string {
  return `Analyze data quality metrics for datasets.

This tool combines multiple data quality analysis capabilities:

## Supported Metrics

### profile
- Provides comprehensive dataset overview
- Column types, distributions, missing rates
- Summary statistics for numeric columns
- Top values for categorical columns

### missing
- Calculate missing value rates for each feature
- Identify features with high missing rates
- Recommendations for handling missing data

### single_value
- Detect features with single or dominant values
- Identify low-variance features
- Recommend removal of uninformative features

### variance
- Compute variance and standard deviation
- Calculate coefficient of variation
- Assess feature variability

### entropy
- Calculate Shannon entropy
- Measure information content
- Identify low-information features

### quantile_collapse
- Detect quantile collapse (many values at same quantile)
- Identify distribution issues
- Flag potential data quality problems

### temporal
- Analyze temporal consistency across time periods
- Detect drift in feature distributions
- Identify unstable features

### collinearity
- Detect highly correlated feature pairs
- Calculate correlation coefficients
- Recommend removing redundant features

## Usage Examples

### Example 1: Full data quality report
\`\`\`json
{
  "datasource": "credit_db",
  "table": "applications",
  "metrics": ["profile", "missing", "single_value", "variance"]
}
\`\`\`

### Example 2: Analyze specific features
\`\`\`json
{
  "filePath": "/data/features.csv",
  "features": ["age", "income", "credit_score"],
  "metrics": ["missing", "variance", "entropy"]
}
\`\`\`

### Example 3: Check for data issues
\`\`\`json
{
  "datasource": "risk_db",
  "table": "features",
  "metrics": ["single_value", "quantile_collapse", "collinearity"]
}
\`\`\`

## Parameters

- **datasource** (optional): Name of the data source (e.g., "credit_db")
- **table** (optional): Table name (for SQL sources)
- **filePath** (optional): File path (for local CSV files)
- **features** (optional): Specific features to analyze. If not provided, analyzes all columns
- **metrics** (required): Array of metrics to compute
- **sampleSize** (optional): Sample size for large datasets (default: 10000)

## Output

Returns an object with results for each requested metric:
- Each metric returns an array of results (one per feature)
- Results include interpretations and recommendations
- Profile metric returns overall dataset summary

## Notes

- At least one of datasource+table or filePath must be provided
- Profile metric analyzes all columns by default
- Other metrics only analyze specified features (or all if not specified)
- Collinearity requires at least 2 numeric features
- Temporal analysis requires a time-based column
`
}
