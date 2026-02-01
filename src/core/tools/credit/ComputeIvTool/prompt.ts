export function getComputeIvPrompt(): string {
  return `Calculate Information Value (IV) and Weight of Evidence (WOE) for feature selection in binary classification.

IV measures the predictive power of a feature for a binary target (e.g., default/non-default in credit scoring).

IV Formula:
WOE = ln(Good% / Bad%)
IV = Σ (Good% - Bad%) × WOE

IV Interpretation:
- IV < 0.02: Weak (not predictive, consider removing)
- 0.02 ≤ IV < 0.1: Medium (weak predictive power)
- 0.1 ≤ IV < 0.3: Strong (medium predictive power, good for modeling)
- 0.3 ≤ IV < 0.5: Strong (strong predictive power, excellent for modeling)
- IV ≥ 0.5: Suspicious (too high, check for data leakage)

Use this tool for:
- Feature selection for credit scoring models
- Identify data leakage (suspicious IV)
- Understand feature-target relationship
- Generate scorecard binning

Binning Methods:
- quantile: Equal-frequency bins (recommended for skewed distributions)
- equal_width: Equal-width bins (good for uniform distributions)
- tree: Decision tree-based binning (optimal splits)

Guidelines:
- Target must be binary (0/1)
- Use 10 bins for most cases
- Check for suspicious IV (>0.5) indicating data leakage
- Select features with IV > 0.1 for modeling

Example usage:
- Basic IV: { datasource: "credit_db", table: "applications", features: ["credit_score", "income"], target: "default_flag" }
- Custom binning: { filePath: "data.csv", features: ["age", "debt_ratio"], target: "default", bins: 20, method: "tree" }`
}
