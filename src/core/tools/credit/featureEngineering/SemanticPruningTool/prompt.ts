export function getSemanticPruningPrompt(): string {
  return `
# SemanticPruningTool (Gate 1)

Filter unreasonable feature combinations using semantic rules and business logic, with zero computational cost.

## Purpose
- Filter candidates without scanning data or invoking models
- Leverage domain knowledge to eliminate semantically invalid combinations
- Maximize pruning efficiency while minimizing computational cost

## Workflow

### 1. Input
- primitives: Feature primitives configuration (from feature_primitives.yaml)
- candidates: All possible feature combinations (~210,000)

### 2. Apply Pruning Rules

#### 2.1 Hard Constraints from Primitives
Read subject constraints from feature_primitives.yaml:

\`\`\`yaml
subjects:
  - id: i
    stability: low        # Low stability
    max_window: 180d      # Max window 180 days
    allow_lifecycle: false
    allow_network: false
    allow_realtime: true
\`\`\`

**Pruning Rules**:
- Low stability subject + long window (> max_window) → Prune
- Subject not supporting lifecycle + lifecycle feature → Prune
- Subject not supporting network + network feature → Prune
- Subject not supporting realtime + realtime feature → Prune

#### 2.2 Business Logic Pruning
Rules based on domain knowledge:

| Rule | Reason | Example |
|------|--------|---------|
| ratio × window <= 7d | Short window ratios are noisy | i_ratio_cnt_loan_7d ❌ |
| device × window > 90d | Device stability insufficient | d_cnt_login_180d ❌ |
| lifecycle × window < 90d | Lifecycle needs sufficient history | i_lifecycle_loan_30d ❌ |
| network × realtime | Graph computation not suitable for realtime | i_network_device_realtime ❌ |
| mom × window < 30d | MoM needs sufficient history | i_mom_cnt_login_7d ❌ |

#### 2.3 Metric Compatibility Check
Certain metrics only apply to specific feature types:

- Lifecycle features: Only continuous metrics (avg, max, min), not discrete counts (cnt)
- Ratio features: Denominator cannot be zero combinations
- Trend features: Require at least 2 time points

### 3. Pruning Logic Example

\`\`\`typescript
function shouldPrune(candidate: FeatureCandidate, primitives: Primitives): boolean {
  const subject = primitives.subjects.find(s => s.id === candidate.subject)

  // Check window constraint
  if (subject.max_window && candidate.window > subject.max_window) {
    return true  // Prune: exceeds max window
  }

  // Check lifecycle constraint
  if (candidate.calculation === 'lifecycle' && !subject.allow_lifecycle) {
    return true  // Prune: lifecycle not supported
  }

  // Check business rules
  if (candidate.calculation === 'ratio' && candidate.window <= 7) {
    return true  // Prune: short window ratio too noisy
  }

  if (candidate.subject === 'd' && candidate.window > 90) {
    return true  // Prune: device long window unstable
  }

  return false  // Keep
}
\`\`\`

### 4. Output
Returns:
- passed: Candidates that passed pruning
- pruned: Pruned features with reasons
- summary: Statistics (pruning rate, rule hit counts)

## Efficiency Gain
- Input: 210,000 candidates
- Output: 50,000 candidates (76% pruned)
- Cost: Zero computation, zero tokens (pure rule-based)

## Usage Example

\`\`\`typescript
const pruned = await SemanticPruningTool.call({
  primitives: primitives,
  candidates: allCandidates
})

console.log(\`Before pruning: \${allCandidates.length}\`)
console.log(\`After pruning: \${pruned.passed.length}\`)
console.log(\`Pruning rate: \${(1 - pruned.passed.length / allCandidates.length) * 100}%\`)
\`\`\`

## Notes
- This is the first gate - prefer conservative (less pruning) over aggressive
- Pruned features won't enter subsequent evaluation, ensure rules are accurate
- Rules should be based on clear business logic, avoid subjective judgment
`.trim()
}
