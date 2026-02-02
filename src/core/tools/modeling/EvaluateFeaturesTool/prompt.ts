export function getEvaluateFeaturesPrompt(): string {
  return `Evaluate feature predictive power and stability for credit modeling.

This tool combines multiple feature evaluation capabilities:

## Supported Metrics

### iv (Information Value)
- Measures predictive power of features against binary target
- Calculates Weight of Evidence (WOE) for each bin
- Identifies strong, weak, and suspicious features
- Detects potential data leakage (IV > 0.5)

### psi (Population Stability Index)
- Measures distribution stability between baseline and current data
- Detects population drift over time
- Identifies features with unstable distributions
- Helps monitor model performance degradation

### coverage
- Calculates non-missing value rate for each feature
- Identifies features with low coverage
- Recommends features for removal or imputation
- Ensures data quality for modeling

## Usage Examples

### Example 1: Evaluate feature predictive power
\`\`\`json
{
  "datasource": "credit_db",
  "table": "features",
  "features": ["age", "income", "credit_score"],
  "target": "default",
  "metrics": ["iv"]
}
\`\`\`

### Example 2: Check population stability
\`\`\`json
{
  "filePath": "/data/features_current.csv",
  "baselineFilePath": "/data/features_baseline.csv",
  "features": ["age", "income"],
  "target": "default",
  "metrics": ["psi"]
}
\`\`\`

### Example 3: Comprehensive evaluation
\`\`\`json
{
  "datasource": "risk_db",
  "table": "model_features",
  "features": ["feature1", "feature2", "feature3"],
  "target": "target",
  "metrics": ["iv", "psi", "coverage"],
  "bins": 10,
  "method": "quantile"
}
\`\`\`

## Parameters

- **datasource** (optional): Name of the data source
- **table** (optional): Table name (for SQL sources)
- **filePath** (optional): File path for current data
- **baselineFilePath** (optional): File path for baseline data (required for PSI)
- **features** (required): Feature column names to evaluate
- **target** (required): Target variable (must be binary: 0/1)
- **metrics** (required): Array of metrics to compute
- **bins** (optional): Number of bins for binning (default: 10)
- **method** (optional): Binning method - 'quantile', 'equal_width', or 'tree' (default: 'quantile')

## Output

Returns an object with results for each requested metric:

### IV Output
- Feature-level IV values and interpretations
- WOE bins with good/bad rates
- Summary of strong/weak/suspicious features
- Recommendations for feature selection

### PSI Output
- Feature-level PSI values and status
- Bin-level contributions to PSI
- Summary of stable/warning/drift features
- Recommendations for model monitoring

### Coverage Output
- Feature-level coverage rates
- Valid/total counts
- Status (good/warning/poor)
- Recommendations for data quality

## Notes

- Target must be binary (0/1) for IV calculation
- PSI requires baseline data for comparison
- Coverage can be computed without target
- All metrics support custom binning strategies
`
}
