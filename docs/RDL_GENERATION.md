# RDL Auto-Generation Design

## Overview

This document describes the design for Risk Agent's LLM-powered automatic rule generation and optimization capabilities. The system analyzes data insights and generates new versions of RDL (Rule Definition Language) files without modifying existing rules, ensuring safety and easy rollback.

## Design Philosophy

**Core Principles**:
1. **Generate new versions instead of editing existing files**
   - Original files remain untouched
   - Safe rollback to any previous version
   - Side-by-side comparison of versions
   - Complete audit trail

2. **No specialized generation tools needed**
   - Use existing Foundation Tools (read_file, write_file)
   - LLM handles generation logic through reasoning
   - Follows "Code First" principle from AGENT_DESIGN.md

3. **Sub Agent for complex generation tasks**
   - Dedicated `rdl-generator` sub agent with specialized prompts
   - Independent context and token budget
   - Reusable across different scenarios

## Architecture

### 1. Component Layers

```
┌─────────────────────────────────────────────────────────┐
│                    Main Agent                            │
│  - Task analysis and orchestration                       │
│  - User interaction and decision making                  │
│  - Data analysis and context building                    │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│              RDL Generator Sub Agent                     │
│  - Specialized RDL generation prompts                    │
│  - RDL knowledge base (syntax, templates, examples)      │
│  - Generation, validation, and iteration                 │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│                  Foundation Tools                        │
│  - read_file: Load DSL docs, templates, existing rules   │
│  - write_file: Write new version files                   │
│  - query_sql: Fetch data for analysis                    │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│            Domain Validation Tools                       │
│  - validate_rdl: Syntax validation                       │
│  - validate_semantics: Semantic validation               │
│  - backtest_rule: Performance testing                    │
└─────────────────────────────────────────────────────────┘
```

### 2. Four-Stage Pipeline

```
Data Analysis → Sub Agent Spawn → RDL Generation → Validation & Backtest → Deployment
     ↓                ↓                  ↓                    ↓                ↓
Main Agent      Main Agent        Sub Agent            Sub Agent        Main Agent
```

### 3. Version Management Structure

```typescript
// Version naming convention
interface RuleVersion {
  name: string              // Rule name: "credit_approval"
  version: string           // Version: "v1", "v2", "v3"
  filePath: string          // File path: "pipelines/credit_approval_v2.yaml"
  metadata: {
    createdAt: string
    createdBy: 'human' | 'ai'
    baseVersion?: string    // Base version for modifications
    reason: string          // Generation reason
    changes: string[]       // Change summary
    performance?: {         // Backtest performance
      ks: number
      auc: number
      approval_rate: number
    }
  }
}

// Version registry
interface VersionRegistry {
  rules: {
    [ruleName: string]: {
      active: string        // Current production version
      latest: string        // Latest version
      versions: RuleVersion[]
    }
  }
}
```

### 4. Analysis Context

```typescript
interface AnalysisContext {
  // Data insights
  insights: {
    metrics: { ks: number; auc: number; approval_rate: number }
    anomalies: { field: string; issue: string; severity: string }[]
    distributions: { field: string; stats: any }[]
  }

  // Current rules
  currentRules: {
    rdl: string           // Read from repository
    performance: any      // Backtest results
    issues: string[]      // Known issues
  }

  // Business constraints
  constraints: {
    regulatory: string[]  // Compliance requirements
    business: any         // Business metric requirements
  }
}
```

## RDL Generator Sub Agent

### Sub Agent Definition

```typescript
// Agent type registration
const RDL_GENERATOR_AGENT = {
  type: 'rdl-generator',
  description: 'Specialized agent for generating and optimizing RDL rules',
  tools: [
    'read_file',          // Load DSL docs, templates, existing rules
    'write_file',         // Write new version files
    'edit_file',          // Fix syntax errors
    'validate_rdl',       // Syntax validation
    'validate_semantics', // Semantic validation
    'backtest_rule',      // Performance testing
    'query_sql'           // Data analysis if needed
  ],
  systemPrompt: RDL_GENERATOR_SYSTEM_PROMPT
}
```

### System Prompt

```typescript
const RDL_GENERATOR_SYSTEM_PROMPT = `
You are an expert RDL (Rule Definition Language) generator for CORINT risk control system.

## Your Capabilities
1. Generate complete RDL YAML files (rules, rulesets, pipelines, features, lists)
2. Optimize existing rules based on data analysis
3. Validate syntax and semantics automatically
4. Run backtests and analyze results
5. Iteratively fix errors until validation passes

## Knowledge Base
You have access to:
- RDL DSL syntax documentation (knowledge/rdl/*.md)
- Rule templates and patterns (repository/library/**/*.yaml)
- Best practices for risk control
- Historical examples (knowledge/rdl/examples/*.yaml)

## Workflow
1. Load RDL knowledge base (syntax, templates, examples)
2. Analyze requirements and constraints
3. Generate complete YAML content
4. Validate syntax and semantics
5. Auto-fix errors if validation fails
6. Run backtest and analyze performance
7. Iterate if needed (max 3 iterations)

## Output Format
Always return structured results:
{
  "success": true/false,
  "filePath": "path/to/generated/file.yaml",
  "validation": { "valid": true/false, "errors": [] },
  "backtest": { "ks": 0.45, "auc": 0.82, ... },
  "changes": ["change 1", "change 2", ...],
  "iterations": 1
}

## Important Rules
- Always generate COMPLETE new files, never edit existing files
- Include detailed comments explaining logic
- Ensure all thresholds are data-driven
- Follow RDL syntax strictly
- Auto-fix syntax errors when possible
`
```

### Usage Patterns

#### Pattern 1: Main Agent Auto-Invokes (Recommended)

```typescript
// User request: "Optimize credit_approval rule"
class RiskAgent {
  async handleRequest(userMessage: string) {
    // Main agent analyzes intent
    const intent = await this.analyzeIntent(userMessage)

    if (intent.type === 'optimize_rule' || intent.type === 'generate_rule') {
      // Build analysis context
      const context = await this.buildAnalysisContext(intent.params)

      // Automatically spawn rdl-generator sub agent
      const result = await this.spawnAgent('rdl-generator', {
        mode: intent.type === 'optimize_rule' ? 'optimize' : 'create',
        ruleName: intent.params.ruleName,
        context: context
      })

      // Main agent handles result and user interaction
      return await this.handleGenerationResult(result)
    }
  }
}
```

#### Pattern 2: User Explicitly Specifies

```bash
# User directly requests sub agent
User: "Use rdl-generator to create a new fraud detection rule"

# Main agent recognizes and invokes
Agent: 🤖 Launching RDL Generator...
       ✅ Generated: fraud_detection_v1.yaml
```

#### Pattern 3: Optional Skill Wrapper

```typescript
// Skill: /optimize-rule (optional, for standardized workflows)
async function optimizeRuleSkill(ruleName: string) {
  // Step 1: Data analysis (main agent)
  const context = await buildAnalysisContext(ruleName)

  // Step 2: Generate new version (sub agent)
  const result = await spawnAgent('rdl-generator', {
    mode: 'optimize',
    ruleName,
    context
  })

  // Step 3: User confirmation (main agent)
  const action = await askUserQuestion(...)

  // Step 4: Deployment (main agent)
  if (action === 'deploy') {
    await deployConfig(result.filePath, 'test')
  }
}
```

## Implementation

### Stage 1: Main Agent Prepares Context

```typescript
// Main agent builds context and spawns sub agent
async function buildAnalysisContext(ruleName: string): Promise<AnalysisContext> {
  // 1. Query current rule performance
  const currentPerformance = await querySql(`
    SELECT ks, auc, approval_rate
    FROM rule_metrics
    WHERE rule_name = '${ruleName}'
    ORDER BY date DESC LIMIT 1
  `)

  // 2. Detect anomalies
  const anomalies = await querySql(`
    SELECT field, issue, severity
    FROM data_quality_issues
    WHERE rule_name = '${ruleName}' AND status = 'open'
  `)

  // 3. Load current rule
  const registry = await loadVersionRegistry()
  const activeVersion = registry.rules[ruleName]?.active
  const rdlContent = await readFile(
    `repository/pipelines/${ruleName}_${activeVersion}.yaml`
  )

  return {
    insights: {
      metrics: currentPerformance,
      anomalies: anomalies,
      distributions: await getFieldDistributions(ruleName)
    },
    currentRules: {
      rdl: rdlContent,
      performance: currentPerformance,
      issues: anomalies.map(a => a.issue)
    },
    constraints: {
      regulatory: await getRegulatoryConstraints(),
      business: await getBusinessConstraints(ruleName)
    }
  }
}
```

### Stage 2: Sub Agent Generates New Version

```typescript
// Sub agent internal workflow
async function rdlGeneratorWorkflow(params: {
  mode: 'optimize' | 'create'
  ruleName: string
  context: AnalysisContext
}) {
  // Step 1: Load RDL knowledge base
  const rdlKnowledge = await loadRDLKnowledge()

  // Step 2: Determine base version and new version number
  const registry = await loadVersionRegistry()
  const ruleInfo = registry.rules[params.ruleName]

  let baseVersion: string | null = null
  let baseContent: string | null = null

  if (params.mode === 'optimize' && ruleInfo) {
    baseVersion = ruleInfo.active || ruleInfo.latest
    baseContent = await readFile(
      `repository/pipelines/${params.ruleName}_${baseVersion}.yaml`
    )
  }

  const newVersion = getNextVersion(ruleInfo?.versions || [])
  const newFilePath = `repository/pipelines/${params.ruleName}_${newVersion}.yaml`

  // Step 3: Generate new RDL content
  const prompt = buildGenerationPrompt({
    mode: params.mode,
    baseContent,
    baseVersion,
    analysisContext: params.context,
    rdlKnowledge
  })

  let newRDLContent = await llm.generate(prompt)

  // Step 4: Write new file (original file untouched)
  await writeFile(newFilePath, newRDLContent)

  // Step 5: Validate and iterate if needed
  let iteration = 0
  let validation = await validateAndBacktest(newFilePath)

  while (!validation.valid && iteration < 3) {
    // Auto-fix syntax errors
    newRDLContent = await fixSyntaxErrors(newRDLContent, validation.errors)
    await writeFile(newFilePath, newRDLContent)
    validation = await validateAndBacktest(newFilePath)
    iteration++
  }

  if (!validation.valid) {
    await deleteFile(newFilePath)
    throw new Error(`Failed to generate valid RDL after ${iteration} iterations`)
  }

  // Step 6: Update version registry
  await updateVersionRegistry(registry, {
    ruleName: params.ruleName,
    version: newVersion,
    filePath: newFilePath,
    metadata: {
      createdAt: new Date().toISOString(),
      createdBy: 'ai',
      baseVersion,
      reason: params.context.reason,
      changes: extractChanges(baseContent, newRDLContent),
      performance: validation.backtestResult
    }
  })

  return {
    success: true,
    newVersion,
    filePath: newFilePath,
    validation,
    diff: generateDiff(baseContent, newRDLContent),
    iterations: iteration
  }
}
```

### Stage 3: Prompt Design for Sub Agent

```typescript
function buildGenerationPrompt(params: {
  mode: 'optimize' | 'create'
  baseContent: string | null
  baseVersion: string | null
  analysisContext: AnalysisContext
  rdlKnowledge: any
}) {
  if (params.mode === 'optimize') {
    return `
# Task: Generate optimized version of risk control rule

## Current Version (${params.baseVersion})
\`\`\`yaml
${params.baseContent}
\`\`\`

## Data Analysis Results
- Current performance: KS=${params.analysisContext.insights.metrics.ks}, AUC=${params.analysisContext.insights.metrics.auc}
- Issues found: ${params.analysisContext.currentRules.issues.join(', ')}
- Anomalies: ${JSON.stringify(params.analysisContext.insights.anomalies)}

## Optimization Goals
${params.analysisContext.reason}

## Requirements
1. **Generate complete new version YAML file** (not edit instructions)
2. Maintain original rule structure and naming
3. Optimize thresholds/conditions/features based on data
4. Add comments explaining each modification
5. Ensure compliance with RDL syntax

## RDL Syntax Reference
${params.rdlKnowledge.syntax}

## Output Format
Output complete YAML content directly, without any prefix or suffix.
`
  } else {
    return `
# Task: Generate new risk control rule

## Business Requirements
${params.analysisContext.reason}

## Data Insights
${JSON.stringify(params.analysisContext.insights, null, 2)}

## Business Constraints
${JSON.stringify(params.analysisContext.constraints, null, 2)}

## RDL Syntax and Templates
${params.rdlKnowledge.syntax}

Example templates:
${params.rdlKnowledge.templates}

## Requirements
1. Generate complete RDL YAML file
2. Include complete structure: metadata, features, rules, pipeline
3. Set thresholds based on data analysis
4. Add detailed comments
5. Follow best practices

## Output Format
Output complete YAML content directly.
`
  }
}
```

### Stage 4: Validation and Backtest

```typescript
async function validateAndBacktest(rdlPath: string) {
  // 1. Syntax validation
  const syntaxResult = await validateRDL(rdlPath)
  if (!syntaxResult.valid) {
    // LLM auto-fixes syntax errors
    await fixSyntaxErrors(rdlPath, syntaxResult.errors)
  }

  // 2. Semantic validation
  const semanticResult = await validateSemantics(rdlPath, schema)

  // 3. Backtest
  const backtestResult = await backtestRule(rdlPath, historicalData)

  // 4. LLM analyzes backtest results
  const analysis = await llm.analyze(`
    Backtest results: ${backtestResult}
    Does it meet business goals?
    Does it need adjustment?
  `)

  return { valid: true, analysis, backtestResult }
}
```

### Stage 5: Main Agent Handles Results

```typescript
// Main agent processes sub agent results and interacts with user
async function handleGenerationResult(result: {
  success: boolean
  newVersion: string
  filePath: string
  validation: any
  diff: string
  iterations: number
}) {
  if (!result.success) {
    console.log(`❌ Generation failed after ${result.iterations} iterations`)
    return
  }

  // Show comparison
  console.log(`\n📊 Version Comparison:`)
  console.log(`New version: ${result.newVersion}`)
  console.log(`\nChange summary:`)
  result.validation.changes?.forEach(change => console.log(`  - ${change}`))

  console.log(`\nPerformance:`)
  console.log(`  KS: ${result.validation.backtestResult.ks}`)
  console.log(`  AUC: ${result.validation.backtestResult.auc}`)

  // User confirmation
  const action = await askUserQuestion({
    question: "How to handle the new version?",
    options: [
      { label: "Deploy to test", value: "deploy_test" },
      { label: "Create A/B test", value: "ab_test" },
      { label: "Save only", value: "save_only" },
      { label: "Discard", value: "discard" }
    ]
  })

  // Execute action
  switch (action) {
    case 'deploy_test':
      await switchActiveVersion(ruleName, result.newVersion, 'test')
      break
    case 'ab_test':
      await createABTest({ ... })
      break
    case 'save_only':
      console.log(`✅ Saved: ${result.filePath}`)
      break
    case 'discard':
      await deleteFile(result.filePath)
      break
  }
}
```

### Stage 6: Version Comparison and Switching

```typescript
// Compare two versions
async function compareVersions(
  ruleName: string,
  version1: string,
  version2: string
) {
  const file1 = await readFile(`pipelines/${ruleName}_${version1}.yaml`)
  const file2 = await readFile(`pipelines/${ruleName}_${version2}.yaml`)

  // Generate visual diff
  const diff = generateDiff(file1, file2)

  // Compare performance metrics
  const perf1 = await getVersionPerformance(ruleName, version1)
  const perf2 = await getVersionPerformance(ruleName, version2)

  return {
    diff,
    performanceComparison: {
      [version1]: perf1,
      [version2]: perf2,
      improvement: calculateImprovement(perf1, perf2)
    }
  }
}

// Switch active version
async function switchActiveVersion(
  ruleName: string,
  targetVersion: string,
  env: 'test' | 'staging' | 'prod'
) {
  const registry = await loadVersionRegistry()

  // Create switch checkpoint
  const checkpoint = await createSwitchCheckpoint(ruleName, env)

  try {
    // Update registry
    registry.rules[ruleName].active = targetVersion
    await saveVersionRegistry(registry)

    // Deploy to target environment
    const filePath = `pipelines/${ruleName}_${targetVersion}.yaml`
    await deployConfig(filePath, env)

    return { success: true, checkpoint }
  } catch (error) {
    // Auto-rollback on failure
    await rollbackFromCheckpoint(checkpoint)
    throw error
  }
}
```

## Knowledge Base Integration

### RDL Knowledge Base Structure

```
corint-agent/
├── config/
│   └── datasource.yaml
├── knowledge/
│   └── rdl -> ../../corint-decision/docs/dsl  # Symlink to RDL DSL docs
├── repository -> ../corint-decision/repository # Symlink to rule repository
└── ...

corint-decision/
├── docs/
│   └── dsl/                        # RDL DSL documentation
│       ├── overall.md              # DSL overview
│       ├── rule.md                 # Rule syntax
│       ├── ruleset.md              # Ruleset syntax
│       ├── pipeline.md             # Pipeline syntax
│       ├── feature.md              # Feature syntax
│       ├── expression.md           # Expression syntax
│       └── examples/               # Example files
└── repository/                     # RDL rule repository
    ├── pipelines/                  # Rule pipeline files
    ├── configs/                    # Configuration files
    ├── library/                    # Rule templates
    └── registry.yaml               # Version registry
```

### RDL Context Injection

```typescript
// Load RDL knowledge at sub agent initialization
class RDLKnowledgeLoader {
  async load() {
    const dslDocs = await this.loadDSLDocs()
    const templates = await this.loadTemplates()
    const examples = await this.loadExamples()

    return {
      syntax: this.parseDSLSyntax(dslDocs),
      patterns: this.extractPatterns(templates),
      examples: examples
    }
  }

  private async loadDSLDocs() {
    // Load from symlinked knowledge directory
    const files = await glob('knowledge/rdl/*.md')
    return Promise.all(files.map(f => readFile(f)))
  }

  private async loadTemplates() {
    // Load from symlinked repository
    const files = await glob('repository/library/**/*.yaml')
    return Promise.all(files.map(f => readFile(f)))
  }

  private async loadExamples() {
    const files = await glob('knowledge/rdl/examples/**/*.yaml')
    return Promise.all(files.map(f => readFile(f)))
  }
}
```

## Version Management

### Cleanup Strategy

```typescript
// Auto-cleanup old versions
async function cleanupOldVersions(
  ruleName: string,
  keepCount: number = 5  // Keep latest 5 versions
) {
  const registry = await loadVersionRegistry()
  const versions = registry.rules[ruleName]?.versions || []

  if (versions.length <= keepCount) {
    return { cleaned: 0 }
  }

  // Sort by time, keep latest N versions
  const sortedVersions = versions.sort(
    (a, b) => new Date(b.metadata.createdAt).getTime() -
              new Date(a.metadata.createdAt).getTime()
  )

  const toKeep = sortedVersions.slice(0, keepCount)
  const toDelete = sortedVersions.slice(keepCount)

  // Always keep active version
  const activeVersion = registry.rules[ruleName].active
  const toDeleteFiltered = toDelete.filter(v => v.version !== activeVersion)

  // Delete files
  for (const version of toDeleteFiltered) {
    await deleteFile(version.filePath)
  }

  // Update registry
  registry.rules[ruleName].versions = [
    ...toKeep,
    ...toDelete.filter(v => v.version === activeVersion)
  ]
  await saveVersionRegistry(registry)

  return { cleaned: toDeleteFiltered.length }
}
```

### Directory Structure

```
repository/                          # Symlink to ../corint-decision/repository
├── pipelines/
│   ├── credit_approval_v1.yaml      # Original version
│   ├── credit_approval_v2.yaml      # AI optimization v1
│   ├── credit_approval_v3.yaml      # AI optimization v2
│   ├── fraud_detection_v1.yaml
│   └── fraud_detection_v2.yaml
├── configs/
│   └── ...
├── library/                         # Rule templates
│   └── ...
└── registry.yaml                    # Version registry
```

### Registry Example

```yaml
rules:
  credit_approval:
    active: v1              # Current production version
    latest: v3              # Latest version
    versions:
      - version: v1
        filePath: pipelines/credit_approval_v1.yaml
        metadata:
          createdAt: "2024-01-01T00:00:00Z"
          createdBy: human
          reason: "Initial version"
      - version: v2
        filePath: pipelines/credit_approval_v2.yaml
        metadata:
          createdAt: "2024-01-15T10:30:00Z"
          createdBy: ai
          baseVersion: v1
          reason: "Optimize approval rate, reduce bad debt"
          changes:
            - "Adjust credit score threshold: 600 → 620"
            - "Add multi-loan detection rule"
          performance:
            ks: 0.45
            auc: 0.82
            approval_rate: 0.68
      - version: v3
        filePath: pipelines/credit_approval_v3.yaml
        metadata:
          createdAt: "2024-01-20T14:20:00Z"
          createdBy: ai
          baseVersion: v2
          reason: "Fix high-risk region false positive issue"
          changes:
            - "Refine regional risk levels"
            - "Adjust income verification logic"
          performance:
            ks: 0.47
            auc: 0.83
            approval_rate: 0.71
```

## User Interaction Examples

### Example 1: Natural Language Request (Main Agent Auto-Invokes)

```bash
User: "帮我优化 credit_approval 规则，最近通过率太低了"

Agent: 🔍 分析规则性能数据...
       📊 当前性能: KS=0.42, AUC=0.78, 通过率=65%
       🤖 启动 RDL Generator 生成优化方案...

       ✅ 已生成新版本: credit_approval_v2.yaml

       📊 版本对比:
       基础版本: v1
       新版本: v2

       变更摘要:
       - 调整信用分阈值: 600 → 580
       - 优化收入验证逻辑
       - 新增多头借贷检测规则

       性能对比:
       KS: 0.42 → 0.45 (+7%)
       AUC: 0.78 → 0.81 (+4%)
       预计通过率: 65% → 72% (+7%)

       如何处理新版本?
       1. 部署到测试环境
       2. 创建 A/B 测试
       3. 仅保存不部署
       4. 放弃新版本
```

### Example 2: Explicit Sub Agent Request

```bash
User: "用 rdl-generator 创建一个新的反欺诈规则"

Agent: 🤖 启动 RDL Generator...
       📚 加载 RDL 知识库...
       ✍️  生成新规则...
       ✅ 验证通过

       ✅ 已生成: fraud_detection_v1.yaml

       规则包含:
       - IP 地址风险检测
       - 设备指纹识别
       - 行为异常检测

       是否部署到测试环境?
```

### Example 3: Optional Skill Wrapper (Standardized Workflow)

```bash
User: "/optimize-rule credit_approval"

Agent: 📋 执行规则优化标准流程...

       Step 1/4: 数据分析 ✓
       - 查询最近 30 天性能数据
       - 检测数据质量问题
       - 分析字段分布

       Step 2/4: 生成新版本 ✓
       - 启动 RDL Generator
       - 生成优化方案
       - 验证语法和语义

       Step 3/4: 回测验证 ✓
       - 在历史数据上回测
       - KS: 0.42 → 0.45
       - AUC: 0.78 → 0.81

       Step 4/4: 等待用户确认...
```

## Iterative Optimization

```typescript
async function iterativeOptimization(ruleName: string, maxIterations = 3) {
  let iteration = 0
  let bestResult = null

  while (iteration < maxIterations) {
    const result = await optimizeRuleOnce(ruleName)

    if (result.metrics.improvement < 0.01) {
      break // Converged
    }

    if (!bestResult || result.metrics.score > bestResult.metrics.score) {
      bestResult = result
    }

    iteration++
  }

  return bestResult
}
```

## Key Benefits

1. **Safety**: Original files never modified, zero risk of breaking production rules
2. **Rollback**: Instant rollback to any previous version
3. **Comparison**: Side-by-side comparison of versions with performance metrics
4. **Audit Trail**: Complete history of who changed what and why
5. **A/B Testing**: Easy to run experiments with multiple versions
6. **Iterative Improvement**: Continuous optimization with version tracking
7. **Specialized Context**: Sub agent has dedicated RDL knowledge and optimized prompts
8. **Token Efficiency**: Independent token budget doesn't impact main conversation

## Design Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Tool Strategy** | No specialized `generate_rdl` tool | LLM handles generation through reasoning; use existing Foundation Tools |
| **Agent Architecture** | Dedicated `rdl-generator` sub agent | Complex multi-step workflow needs specialized prompts and context |
| **Invocation Pattern** | Main agent auto-invokes (primary) | User doesn't need to know implementation details |
| **Skill Usage** | Optional, for standardized workflows | Not required; sub agent can be called directly |
| **Version Strategy** | Always generate new files | Never edit existing files; ensures safety and rollback |
| **Knowledge Base** | Symlink `docs/dsl` to `repository/knowledge` | Unified knowledge access path |

## Implementation Priority

### Phase 1: Foundation (Week 1-2)
- [ ] Version registry structure and utilities
- [ ] Knowledge base symlink setup
- [ ] RDL knowledge loader implementation
- [ ] Basic validation tools (validate_rdl, validate_semantics, backtest_rule)

### Phase 2: Sub Agent (Week 3-4)
- [ ] `rdl-generator` sub agent definition
- [ ] Specialized system prompt engineering
- [ ] Generation workflow implementation
- [ ] Auto syntax error fixing logic
- [ ] Iterative validation loop (max 3 iterations)

### Phase 3: Integration (Week 5-6)
- [ ] Main agent intent recognition
- [ ] Context building utilities
- [ ] Result handling and user interaction
- [ ] Version comparison and switching
- [ ] A/B test integration

### Phase 4: Optional Enhancements (Week 7-8)
- [ ] `/optimize-rule` skill (standardized workflow)
- [ ] Version cleanup automation
- [ ] Performance monitoring dashboard
- [ ] Multi-rule batch optimization

## References

- CORINT Decision Engine: `../corint-decision/docs/ARCHITECTURE.md`
- RDL DSL Design: `../corint-decision/docs/dsl/*.md`
- Agent Design: `./AGENT_DESIGN.md`

---

**Document Version**: 2.0
**Last Updated**: 2026-01-24
**Status**: Design Phase - Updated with Sub Agent Architecture
