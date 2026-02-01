export function getComputePsiPrompt(): string {
  return `Calculate Population Stability Index (PSI) to detect distribution drift between datasets.

PSI measures the change in distribution between a baseline dataset and a current dataset. It's commonly used for:
- Model monitoring (detect data drift)
- Feature stability tracking
- A/B test validation
- Production vs training data comparison

PSI Formula:
PSI = Σ (Current% - Baseline%) × ln(Current% / Baseline%)

PSI Interpretation:
- PSI < 0.1: Stable (no significant change)
- 0.1 ≤ PSI < 0.25: Warning (moderate change, investigate)
- PSI ≥ 0.25: Drift (significant change, model may need retraining)

Binning Methods:
- quantile: Equal-frequency bins (recommended for skewed distributions)
- equal_width: Equal-width bins (good for uniform distributions)

Guidelines:
- Use 10 bins for most cases
- Compare same time periods (e.g., month-to-month)
- Check PSI for all model features regularly
- Investigate high PSI features for root cause

Example usage:
- Compare datasets: { baselineData: "credit_db.training_data", currentData: "credit_db.production_data", columns: ["credit_score", "income"] }
- Custom binning: { baselineData: "file1.csv", currentData: "file2.csv", columns: ["age"], bins: 20, method: "equal_width" }`
}
