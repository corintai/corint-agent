export function getGenerateFeaturesPrompt(): string {
  return `Generate features for credit modeling.

This tool combines multiple feature generation capabilities:

## Supported Feature Types

### window
- Generate time-window aggregation features
- Examples: sum_amount_7d, avg_count_30d, max_value_90d
- Supports multiple aggregation methods (sum, avg, max, min, count, etc.)
- Configurable time windows (days, weeks, months)

### ratio
- Generate ratio and rate features
- Examples: approval_rate, amount_per_transaction, change_rate
- Compares metrics across different dimensions
- Useful for capturing relative patterns

### cross
- Generate cross-product features
- Examples: age_x_income, region_x_product
- Combines multiple features for interaction effects
- Captures non-linear relationships

### credit
- Generate credit-specific features
- Examples: debt_to_income, utilization_rate, payment_history_score
- Domain-specific feature engineering
- Incorporates credit risk knowledge

## Usage Examples

### Example 1: Generate window features
\`\`\`json
{
  "primitivesPath": "/path/to/primitives.json",
  "featureTypes": ["window"],
  "generation": {
    "subjects": ["user", "account"],
    "metrics": ["amount", "count"],
    "windows": ["7d", "30d", "90d"]
  }
}
\`\`\`

### Example 2: Generate multiple types
\`\`\`json
{
  "primitivesPath": "/path/to/primitives.json",
  "featureTypes": ["window", "ratio", "credit"],
  "outputTable": "generated_features"
}
\`\`\`

### Example 3: Generate from candidates
\`\`\`json
{
  "candidates": [
    {
      "name": "user_sum_amount_7d",
      "metric": "amount",
      "object": "transaction",
      "window": {"value": 7, "unit": "d", "label": "7d", "seconds": 604800},
      "family": "basic"
    }
  ],
  "featureTypes": ["window"]
}
\`\`\`

## Parameters

- **primitivesPath** (optional): Path to feature primitives definition file
- **featureTypes** (required): Array of feature types to generate
- **candidates** (optional): Pre-defined feature candidates to generate
- **generation** (optional): Generation configuration for automatic candidate creation
- **outputTable** (optional): Output table name for generated features
- **includeReasoning** (optional): Include reasoning for each feature (default: true)

## Output

Returns:
- **features**: Array of generated feature definitions
  - name: Feature name following naming convention
  - description: Human-readable description
  - type: numeric or categorical
  - formula: SQL or calculation formula
  - reasoning: Why this feature was generated (if includeReasoning=true)
- **statistics**: Generation statistics
  - totalGenerated: Total number of features
  - byType: Count by feature type
  - executionTime: Time taken in milliseconds

## Notes

- Requires feature primitives definition (subjects, metrics, windows, etc.)
- Follows naming conventions defined in primitives
- Respects constraints (max features, budgets, business rules)
- Validates feature candidates before generation
`
}
