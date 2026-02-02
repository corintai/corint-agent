export function getBeamSearchPrompt(): string {
  return `
# BeamSearchFeaturesTool (Gate 3)

Select optimal feature subset using Beam Search strategy under budget constraints.

## Purpose
- Avoid exhaustive enumeration of all candidates (still 5,000)
- Find optimal feature combination within computational budget
- Balance feature diversity and predictive power

## Workflow

### 1. Input
- primitives: Feature primitives configuration
- candidates: Candidate features that passed Gate 2 proxy evaluation (~5,000)
- proxyScores: Proxy metric scores from Gate 2
- beamWidth: Beam width (candidates kept per round, default 50)
- budget: Feature budget configuration

### 2. Budget Configuration
Read budget constraints from feature_primitives.yaml:

\`\`\`yaml
feature_budget:
  total: 500                    # Total feature limit
  per_subject:
    i: 200                      # ID card subject max 200 features
    m: 150
    d: 100
  per_family:
    window: 300                 # Window features max 300
    ratio: 100
    cross: 50
  per_window_type:
    short: 150                  # Short window (<=30d) max 150
    medium: 200                 # Medium window (31-90d) max 200
    long: 150                   # Long window (>90d) max 150
\`\`\`

### 3. Beam Search Strategy

#### Round 1: Base Feature Generation
1. Select Top-K base features from candidates (sorted by proxy score)
2. Keep beam width candidates (default 50)
3. Ensure subject diversity (keep at least N per subject)

\`\`\`typescript
// Sort by proxy score
const sortedCandidates = candidates.sort((a, b) =>
  b.proxyScore - a.proxyScore
)

// Keep Top-K with diversity
const beam = selectDiverseTopK(sortedCandidates, beamWidth, {
  ensureSubjectDiversity: true,
  ensureWindowDiversity: true
})
\`\`\`

#### Round 2: Derived Feature Generation
Generate derived features on Top-K base features:

\`\`\`typescript
// For each base feature, generate derived features
for (const baseFeature of beam) {
  // Generate ratio features
  const ratioFeatures = generateRatioFeatures(baseFeature)

  // Generate trend features
  const trendFeatures = generateTrendFeatures(baseFeature)

  // Generate cross features
  const crossFeatures = generateCrossFeatures(baseFeature, beam)

  candidates.push(...ratioFeatures, ...trendFeatures, ...crossFeatures)
}

// Sort again by score, keep Top-K
beam = selectDiverseTopK(candidates, beamWidth)
\`\`\`

#### Round 3: Full Computation on Top-K
Perform full computation on beam candidates (no longer small sample):

\`\`\`typescript
// Full feature computation
const fullFeatures = await GenerateWindowFeaturesTool.call({
  primitives: primitives,
  selectedFeatures: beam,
  fullCompute: true  // Full computation
})

// Compute real IV/PSI metrics
const ivScores = await ComputeIv.call({
  datasource: 'credit_db',
  features: fullFeatures,
  target: 'is_default'
})
\`\`\`

#### Round 4: Apply Budget Constraints
Sort by importance, apply budget constraints:

\`\`\`typescript
// Sort by IV score
const rankedFeatures = fullFeatures.sort((a, b) =>
  b.iv - a.iv
)

// Apply budget constraints
const finalFeatures = applyBudgetConstraints(rankedFeatures, budget)

function applyBudgetConstraints(features, budget) {
  const selected = []
  const subjectCount = {}
  const familyCount = {}
  const windowCount = {}

  for (const feature of features) {
    // Check total budget
    if (selected.length >= budget.total) break

    // Check subject budget
    if (subjectCount[feature.subject] >= budget.per_subject[feature.subject]) {
      continue
    }

    // Check family budget
    if (familyCount[feature.family] >= budget.per_family[feature.family]) {
      continue
    }

    // Check window type budget
    const windowType = getWindowType(feature.window)
    if (windowCount[windowType] >= budget.per_window_type[windowType]) {
      continue
    }

    // Pass all constraints, select
    selected.push(feature)
    subjectCount[feature.subject]++
    familyCount[feature.family]++
    windowCount[windowType]++
  }

  return selected
}
\`\`\`

### 4. Output
Returns:
- selectedFeatures: Final selected feature list (~500)
- beamHistory: Beam search history
- budgetUsage: Budget usage statistics
- summary: Statistical summary

## Efficiency Gain
- Input: 5,000 candidates (Gate 2 output)
- Output: 500 features (within budget)
- Complexity: O(K × depth) vs exhaustive O(N^4)
- Full computation: Only on Top-K (~150 features)

## Usage Example

\`\`\`typescript
const searched = await BeamSearchFeaturesTool.call({
  primitives: primitives,
  candidates: evaluatedCandidates,
  proxyScores: evaluated.proxyScores,
  beamWidth: 50,
  budget: {
    total: 500,
    per_subject: { i: 200, m: 150, d: 100 },
    per_family: { window: 300, ratio: 100, cross: 50 },
    per_window_type: { short: 150, medium: 200, long: 150 }
  }
})

console.log(\`Final features: \${searched.selectedFeatures.length}\`)
console.log(\`Budget usage: \${JSON.stringify(searched.budgetUsage)}\`)
\`\`\`

## Notes
- Beam width affects search quality and efficiency, recommend 30-100
- Budget constraints should be adjusted based on business needs
- Ensure feature diversity, avoid over-concentration on one subject or window
- Full computation only on Top-K to control computational cost
`.trim()
}
