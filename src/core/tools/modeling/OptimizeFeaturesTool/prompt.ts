export function getOptimizeFeaturesPrompt(): string {
  return `Optimize and select features for credit modeling.

This tool combines multiple feature optimization capabilities:

## Supported Methods

### semantic_pruning
- Remove semantically redundant features
- Identify features with similar meanings
- Reduce feature space while preserving information
- Uses semantic similarity analysis

### proxy_eval
- Evaluate features using proxy metrics
- Fast pre-screening without model training
- Metrics: IV, PSI, variance, entropy, correlation
- Filter out low-quality features early

### beam_search
- Iterative feature selection using beam search
- Balances exploration and exploitation
- Considers feature interactions
- Optimizes for target metric (e.g., AUC, KS)

## Usage Examples

### Example 1: Semantic pruning
\`\`\`json
{
  "primitivesPath": "/path/to/primitives.json",
  "candidates": [...],
  "method": "semantic_pruning",
  "maxFeatures": 100
}
\`\`\`

### Example 2: Proxy evaluation
\`\`\`json
{
  "candidates": [...],
  "method": "proxy_eval",
  "threshold": 0.02,
  "targetMetric": "iv"
}
\`\`\`

### Example 3: Beam search
\`\`\`json
{
  "primitivesPath": "/path/to/primitives.json",
  "candidates": [...],
  "method": "beam_search",
  "maxFeatures": 50,
  "targetMetric": "auc"
}
\`\`\`

## Parameters

- **primitivesPath** (optional): Path to feature primitives file
- **candidates** (required): Feature candidates to optimize
- **method** (required): Optimization method to use
- **targetMetric** (optional): Target metric for optimization (e.g., "iv", "auc", "ks")
- **threshold** (optional): Threshold for filtering (method-specific)
- **maxFeatures** (optional): Maximum number of features to select

## Output

Returns:
- **optimizedFeatures**: Array of features with selection results
  - All original candidate fields
  - score: Optimization score (method-specific)
  - rank: Feature rank
  - selected: Whether feature was selected
  - reason: Reason for selection/rejection
- **summary**: Optimization statistics
  - totalInput: Number of input candidates
  - totalOutput: Number of selected features
  - reductionRate: Percentage of features removed
  - method: Method used
  - executionTime: Time taken
- **reasoning**: Overall optimization reasoning

## Notes

- Semantic pruning requires feature descriptions
- Proxy evaluation is fast but less accurate than model-based selection
- Beam search is more accurate but computationally expensive
- All methods respect maxFeatures constraint
`
}
