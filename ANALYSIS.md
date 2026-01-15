# CORINT Risk Agent Integration Analysis

## Executive Summary

This document analyzes how to integrate effective code from `corint-cognition` into `corint-agent` (CORINT Agent CLI) to implement a Risk Agent following the design in `AGENT_DESIGN.md`.

**Goal**: Leverage CORINT Agent's mature CLI infrastructure while adding CORINT's domain-specific agent capabilities for risk management.

---

## 1. Project Overview

### 1.1 corint-agent (CORINT Agent CLI)

**Package**: `@shareai-lab/corint-agent` v2.0.2

**Core Capabilities**:
- Mature CLI interface with Ink/React-based UI
- Multi-model support (OpenAI, Anthropic, Bedrock, Vertex)
- Tool system with permission management
- MCP (Model Context Protocol) integration
- Subagent/Task system for parallel execution
- File operations, search, bash execution
- Web fetch/search capabilities

**Architecture**:
```
src/
├── acp/              # Agent Communication Protocol
├── app/              # Application state management
├── commands/         # CLI commands
├── constants/        # Configuration constants
├── context/          # Context management
├── core/             # Core modules (tools, config, permissions)
├── entrypoints/      # CLI entry points
├── services/         # AI, MCP, auth services
├── tools/            # Tool implementations
├── types/            # TypeScript types
├── ui/               # React/Ink UI components
└── utils/            # Utility functions
```

**Key Strengths**:
- Production-ready CLI with excellent UX
- Robust tool execution framework
- Multi-model orchestration
- Permission and safety controls
- MCP extensibility

### 1.2 corint-cognition

**Package**: `corint-cognition` v1.0.0 (monorepo)

**Packages**:
- `@corint/agent-core` - Agent orchestration core
- `@corint/agent-tools` - Domain-specific tools
- `@corint/agent-skills` - Skills registry
- `@corint/agent-cli` - CLI interface (to be excluded)

**Architecture**:
```
packages/
├── agent-core/
│   ├── orchestrator.ts      # Main agent loop
│   ├── planner.ts           # Task planning
│   ├── executor.ts          # Task execution with tool calls
│   ├── evaluator.ts         # Result evaluation
│   ├── context-manager.ts   # Session/conversation management
│   ├── cost-controller.ts   # Token/query limits
│   ├── llm-client.ts        # LLM abstraction
│   ├── tool.ts              # Tool base class & registry
│   ├── types.ts             # LLM types
│   ├── agent-types.ts       # Agent-specific types
│   └── providers/           # LLM providers (OpenAI, Anthropic, DeepSeek)
├── agent-tools/
│   └── foundation/
│       ├── query-sql.ts         # SQL query execution
│       ├── explore-schema.ts    # Database schema exploration
│       ├── data-source.ts       # Multi-DB connection management
│       ├── call-api.ts          # API calling
│       ├── read-file.ts         # File reading
│       ├── write-file.ts        # File writing
│       ├── list-files.ts        # File listing
│       ├── execute-code.ts      # Code execution
│       ├── run-shell.ts         # Shell command execution
│       └── list-data-sources.ts # List available data sources
└── agent-skills/
    └── index.ts             # Skill registry (basic)
```

**Key Strengths**:
- Domain-specific tools for risk management
- Multi-database support (PostgreSQL, MySQL, ClickHouse)
- Planning/Execution/Evaluation loop
- Cost control mechanisms
- Clean LLM abstraction layer

---

## 2. Integration Strategy

### 2.1 What to Keep from corint-agent

| Component | Path | Reason |
|-----------|------|--------|
| CLI Infrastructure | `src/entrypoints/`, `src/ui/` | Mature, production-ready CLI |
| Tool Framework | `src/core/tools/` | Extensible tool system |
| Permission System | `src/core/permissions/` | Security controls |
| MCP Integration | `src/services/mcp/`, `src/tools/mcp/` | External service integration |
| Config System | `src/core/config/` | User configuration |
| Existing Tools | `src/tools/` | File, search, bash, network tools |
| Multi-model Support | Model management | Flexible model switching |

### 2.2 What to Integrate from corint-cognition

| Component | Source | Target | Priority |
|-----------|--------|--------|----------|
| Data Source Management | `agent-tools/foundation/data-source.ts` | `src/services/datasource/` | High |
| SQL Query Tool | `agent-tools/foundation/query-sql.ts` | `src/tools/data/` | High |
| Schema Explorer | `agent-tools/foundation/explore-schema.ts` | `src/tools/data/` | High |
| Cost Controller | `agent-core/cost-controller.ts` | `src/core/cost/` | Medium |
| Context Manager | `agent-core/context-manager.ts` | `src/services/context/` | Medium |
| Planner Module | `agent-core/planner.ts` | `src/services/planning/` | Medium |
| Evaluator Module | `agent-core/evaluator.ts` | `src/services/evaluation/` | Low |
| LLM Providers | `agent-core/providers/` | Merge with existing | Low |

### 2.3 What to Remove from corint-agent

| Component | Path | Reason |
|-----------|------|--------|
| CORINT Agent Branding | `README.md`, package.json name | Rebrand to CORINT |
| Unused Commands | Review `src/commands/` | Remove non-essential commands |
| Demo/Example Files | Various | Clean up |

### 2.4 What NOT to Integrate from corint-cognition

| Component | Reason |
|-----------|--------|
| `agent-cli/` | Replaced by CORINT Agent's superior CLI |
| `orchestrator.ts` | CORINT Agent has its own orchestration |
| `executor.ts` | CORINT Agent's tool execution is more mature |
| `llm-client.ts` | CORINT Agent already has multi-model support |
| Basic file tools | CORINT Agent's file tools are more complete |

---

## 3. Detailed Integration Plan

### 3.1 Phase 1: Data Source Integration (High Priority)

**Goal**: Add multi-database support for risk data analysis

**Files to Create**:
```
src/services/datasource/
├── index.ts              # Export all
├── data-source.ts        # Adapted from corint-cognition
├── types.ts              # DataSourceConfig, DataSourceClient types
└── config-loader.ts      # YAML/ENV config loading

src/tools/data/
├── QuerySQLTool/
│   ├── QuerySQLTool.tsx  # Tool implementation
│   └── prompt.ts         # Tool prompt
├── ExploreSchemaTools/
│   ├── ExploreSchemaTool.tsx
│   └── prompt.ts
└── ListDataSourcesTool/
    ├── ListDataSourcesTool.tsx
    └── prompt.ts
```

**Adaptation Required**:
1. Convert `Tool` base class to CORINT Agent's tool interface
2. Add React rendering for tool results
3. Integrate with CORINT Agent's permission system
4. Add configuration UI for data sources

### 3.2 Phase 2: Domain Calculation Tools (High Priority)

**Goal**: Add risk-specific calculation capabilities

**Files to Create**:
```
src/tools/risk/
├── CalculateMetricsTool/     # KS, AUC, PSI, IV, Gini
├── CalculateVintageTool/     # Vintage analysis
├── SimulateThresholdTool/    # Threshold simulation
├── BacktestRuleTool/         # Rule backtesting
└── ValidateRDLTool/          # RDL validation
```

**Note**: These tools are defined in AGENT_DESIGN.md but not yet implemented in corint-cognition. They need to be built from scratch.

### 3.3 Phase 3: Planning & Evaluation (Medium Priority)

**Goal**: Add structured planning for complex tasks

**Files to Create**:
```
src/services/planning/
├── index.ts
├── planner.ts            # Adapted from corint-cognition
└── types.ts

src/services/evaluation/
├── index.ts
├── evaluator.ts          # Adapted from corint-cognition
└── types.ts
```

**Integration Points**:
- Hook into CORINT Agent's TaskTool for plan-based execution
- Add plan visualization in UI
- Integrate with TodoWriteTool for progress tracking

### 3.4 Phase 4: Cost Control Enhancement (Medium Priority)

**Goal**: Add token budget and query limits

**Files to Create**:
```
src/core/cost/
├── index.ts
├── cost-controller.ts    # Adapted from corint-cognition
└── types.ts
```

**Integration Points**:
- Merge with existing `src/core/costTracker.ts`
- Add session-level limits
- Add UI for cost warnings

### 3.5 Phase 5: Skills System (Low Priority)

**Goal**: Add domain-specific skills

**Files to Create**:
```
src/services/skills/
├── index.ts
├── skill-registry.ts
├── built-in/
│   ├── daily-report.md
│   ├── rule-optimization.md
│   ├── vintage-analysis.md
│   └── strategy-comparison.md
└── loader.ts
```

**Integration Points**:
- Integrate with existing SkillTool
- Add skill discovery from repository

---

## 4. Tool Interface Adaptation

### 4.1 corint-cognition Tool Interface

```typescript
// From agent-core/tool.ts
abstract class Tool<TInput, TOutput> {
  abstract name: string;
  abstract description: string;
  abstract parameters: z.ZodSchema<TInput>;
  abstract execute(input: TInput, context: ToolExecutionContext): Promise<TOutput>;
  toOpenAITool(): { type: 'function'; function: {...} };
  validate(input: unknown): TInput;
}
```

### 4.2 CORINT Agent Tool Interface

```typescript
// From core/tools/tool.ts
interface Tool<TInput, TOutput> {
  name: string;
  description?: string | ((input?: TInput) => Promise<string>);
  inputSchema: z.ZodTypeAny;
  prompt: (options?: { safeMode?: boolean }) => Promise<string>;
  isEnabled: () => Promise<boolean>;
  isReadOnly: (input?: TInput) => boolean;
  needsPermissions: (input?: TInput) => boolean;
  validateInput?: (input: TInput, context?: ToolUseContext) => Promise<ValidationResult>;
  renderResultForAssistant: (output: TOutput) => string | any[];
  renderToolUseMessage: (input: TInput, options: { verbose: boolean }) => string | React.ReactElement;
  call: (input: TInput, context: ToolUseContext) => AsyncGenerator<...>;
}
```

### 4.3 Adaptation Strategy

Create an adapter function to convert corint-cognition tools:

```typescript
// src/utils/tool-adapter.ts
function adaptCognitionTool<TInput, TOutput>(
  cognitionTool: CognitionTool<TInput, TOutput>
): CORINT AgentTool<TInput, TOutput> {
  return {
    name: cognitionTool.name,
    description: cognitionTool.description,
    inputSchema: cognitionTool.parameters,
    prompt: async () => cognitionTool.description,
    isEnabled: async () => true,
    isReadOnly: () => false,
    needsPermissions: () => true, // Data tools need permission
    renderResultForAssistant: (output) => JSON.stringify(output, null, 2),
    renderToolUseMessage: (input, { verbose }) => {
      // Render tool invocation
    },
    call: async function* (input, context) {
      const result = await cognitionTool.execute(input, {
        sessionId: context.messageId || 'default',
      });
      yield { type: 'result', data: result };
    },
  };
}
```

---

## 5. Configuration Changes

### 5.1 Package.json Updates

```json
{
  "name": "@corint/risk-agent",
  "version": "1.0.0",
  "description": "CORINT Risk Agent - AI-native assistant for risk management",
  "bin": {
    "corint": "cli.js",
    "risk-agent": "cli.js"
  },
  "dependencies": {
    // Add database drivers
    "pg": "^8.x",
    "mysql2": "^3.x",
    "@clickhouse/client": "^1.x",
    "yaml": "^2.x"
  }
}
```

### 5.2 New Configuration Files

```yaml
# repository/datasource.yaml
datasource:
  risk_db:
    type: postgres
    host: ${RISK_DB_HOST}
    port: 5432
    database: risk_data
    user: ${RISK_DB_USER}
    password: ${RISK_DB_PASSWORD}

  analytics_db:
    type: clickhouse
    url: ${CLICKHOUSE_URL}
```

---

## 6. Simplification and Deletion Recommendations

### 6.1 Files to Delete (Branding & Documentation)

| File/Directory | Reason | Action |
|----------------|--------|--------|
| `README.md` | CORINT Agent-specific branding and features | Replace with CORINT README |
| `README.zh-CN.md` | CORINT Agent Chinese documentation | Replace or remove |
| `CONTRIBUTING.md` | CORINT Agent contribution guide | Update for CORINT |
| `DEPLOYMENT_GUIDE.md` | CORINT Agent deployment guide | Update for CORINT |
| `AGENTS.md` | CORINT Agent agents documentation | Update for CORINT |
| `docs/agents-system.md` | CORINT Agent agents system docs | Update or remove |
| `docs/mention-system.md` | CORINT Agent @ mention system docs | Update or remove |
| `docs/intelligent-completion.md` | CORINT Agent completion docs | Update or remove |
| `docs/PUBLISH_GUIDE.md` | CORINT Agent npm publish guide | Remove (internal) |
| `docs/PUBLISH.md` | CORINT Agent publish docs | Remove (internal) |
| `.github/` | CORINT Agent GitHub workflows | Update for CORINT |

### 6.2 Commands to Remove or Simplify

| Command | File | Reason | Action |
|---------|------|--------|--------|
| `/bug` | `src/commands/bug.tsx` | CORINT Agent-specific feedback | Remove or rebrand |
| `/release-notes` | `src/commands/release-notes.ts` | CORINT Agent release notes (disabled) | Remove |
| `/login` | `src/commands/login.tsx` | ShareAI Lab OAuth | Remove (not needed) |
| `/logout` | `src/commands/logout.tsx` | ShareAI Lab OAuth | Remove (not needed) |
| `/pr-comments` | `src/commands/pr-comments.ts` | GitHub PR comments | Keep (useful for dev) |
| `/review` | `src/commands/review.ts` | Code review | Keep (useful for dev) |
| `/tag` | `src/commands/tag.ts` | Git tagging | Keep (useful) |
| `/plugin` | `src/commands/plugin.ts` | Skill marketplace | Simplify or remove |
| `/agents` | `src/commands/agents.tsx` | Agent management | Keep and enhance |
| `/ctx-viz` | `src/commands/ctx-viz.ts` | Context visualization (internal) | Remove |
| `/ctx_viz` | `src/commands/ctx_viz.ts` | Duplicate of ctx-viz | Remove |
| `/listen` | `src/commands/listen.ts` | Internal only | Remove |
| `/messages-debug` | `src/commands/messages-debug.ts` | Debug only | Remove or hide |
| `/refresh-commands` | `src/commands/refresh-commands.ts` | Duplicate | Remove one |
| `/refreshCommands` | `src/commands/refreshCommands.ts` | Duplicate | Remove one |
| `/pr_comments` | `src/commands/pr_comments.ts` | Duplicate of pr-comments | Remove |

### 6.3 Services to Remove or Simplify

| Service | Path | Reason | Action |
|---------|------|--------|--------|
| OAuth Service | `src/services/auth/oauth.ts` | ShareAI Lab specific | Remove |
| Sentry Telemetry | `src/services/telemetry/sentry.ts` | CORINT Agent telemetry | Remove or replace |

### 6.4 Tools to Review

| Tool | Path | Reason | Action |
|------|------|--------|--------|
| AskExpertModelTool | `src/tools/ai/AskExpertModelTool/` | Multi-model consultation | Keep (useful) |
| WebSearchTool | `src/tools/network/WebSearchTool/` | Web search | Keep (useful) |
| WebFetchTool | `src/tools/network/WebFetchTool/` | Web fetch | Keep (useful) |
| SkillTool | `src/tools/ai/SkillTool/` | Skills execution | Keep and enhance |

### 6.5 ACP (Agent Communication Protocol) Module

| Component | Path | Reason | Action |
|-----------|------|--------|--------|
| ACP Module | `src/acp/` | Agent communication protocol | Review - may be useful for multi-agent |
| `corint-agentAcpAgent.ts` | `src/acp/corint-agentAcpAgent.ts` | 45KB, complex | Simplify or remove if not needed |
| `cli-acp.js` | `cli-acp.js` | ACP entry point | Remove if ACP not needed |

### 6.6 Scripts to Review

| Script | Path | Reason | Action |
|--------|------|--------|--------|
| `publish-dev.js` | `scripts/publish-dev.js` | CORINT Agent npm publish | Remove |
| `publish-release.js` | `scripts/publish-release.js` | CORINT Agent npm publish | Remove |
| `reference-parity-check.mjs` | `scripts/reference-parity-check.mjs` | CORINT Agent parity check | Remove |
| `bench-startup.mjs` | `scripts/bench-startup.mjs` | Startup benchmark | Keep (useful) |

### 6.7 Constants and Branding

| File | Path | Reason | Action |
|------|------|--------|--------|
| Product constants | `src/constants/product.ts` | PRODUCT_NAME = "CORINT Agent" | Update to "CORINT" |
| Release notes | `src/constants/releaseNotes.ts` | CORINT Agent release notes | Clear or update |
| Macros | `src/constants/macros.ts` | Version info | Update |

### 6.8 Recommended Deletion Summary

**High Priority Deletions** (Safe to remove immediately):
```
# Duplicate files
src/commands/ctx_viz.ts          # Duplicate
src/commands/pr_comments.ts      # Duplicate
src/commands/refreshCommands.ts  # Duplicate

# Disabled/Internal commands
src/commands/release-notes.ts    # isEnabled: false
src/commands/listen.ts           # Internal only
src/commands/messages-debug.ts   # Debug only

# OAuth (not needed for CORINT)
src/services/auth/oauth.ts
src/commands/login.tsx
src/commands/logout.tsx
```

**Medium Priority Deletions** (Review before removing):
```
# ACP module (if not using multi-agent protocol)
src/acp/                         # Entire directory
cli-acp.js

# CORINT Agent-specific scripts
scripts/publish-dev.js
scripts/publish-release.js
scripts/reference-parity-check.mjs

# Telemetry
src/services/telemetry/sentry.ts
```

**Low Priority** (Rebrand/Update):
```
# Documentation
README.md
README.zh-CN.md
CONTRIBUTING.md
DEPLOYMENT_GUIDE.md
docs/

# Branding
src/constants/product.ts
src/constants/releaseNotes.ts
```

### 6.9 Estimated Code Reduction

| Category | Files | Lines (est.) | Impact |
|----------|-------|--------------|--------|
| Duplicate commands | 3 | ~300 | Low risk |
| OAuth/Auth | 3 | ~500 | Low risk |
| ACP module | 6 | ~3000 | Medium risk |
| Internal commands | 3 | ~400 | Low risk |
| Scripts | 3 | ~300 | Low risk |
| **Total** | **18** | **~4500** | Significant simplification |

---

## 7. Implementation Checklist

### Phase 0: Cleanup (COMPLETED ✅)
- [x] Delete duplicate commands (ctx_viz, pr_comments, refreshCommands)
- [x] Delete disabled commands (release-notes, listen, messages-debug)
- [x] Delete OAuth commands (login, logout, bug)
- [x] Delete OAuth service (src/services/auth/)
- [x] Delete ACP module (src/acp/, cli-acp.js, acp.ts)
- [x] Delete unused scripts (publish-dev.js, publish-release.js, reference-parity-check.mjs)
- [x] Delete Sentry telemetry
- [x] Update product constants (CORINT branding)
- [x] Update package.json (name, bin, dependencies)
- [x] Update README.md

### Phase 1: Foundation (COMPLETED ✅)
- [x] Create `src/services/datasource/` module
- [x] Adapt `data-source.ts` for CORINT Agent
- [x] Create `QuerySQLTool` with CORINT Agent interface
- [x] Create `ExploreSchemaTool` with CORINT Agent interface
- [x] Create `ListDataSourcesTool` with CORINT Agent interface
- [x] Add data source configuration support (YAML, ENV)
- [x] Register tools in tools/index.ts
- [ ] Add permission rules for data tools
- [ ] Test with PostgreSQL, MySQL, ClickHouse

### Phase 2: Domain Tools (PENDING)
- [ ] Design `CalculateMetricsTool` interface
- [ ] Implement KS/AUC/PSI calculations
- [ ] Design `SimulateThresholdTool` interface
- [ ] Design `BacktestRuleTool` interface
- [ ] Design `ValidateRDLTool` interface

### Phase 3: Planning (PENDING)
- [ ] Adapt `planner.ts` for CORINT Agent
- [ ] Integrate with TaskTool
- [ ] Add plan visualization

### Phase 4: Cost Control (PENDING)
- [ ] Merge cost controller with existing tracker
- [ ] Add session limits
- [ ] Add UI warnings

### Phase 5: Skills (PENDING)
- [ ] Create built-in skill definitions
- [ ] Integrate with SkillTool
- [ ] Add skill discovery

### Phase 6: Final Cleanup (PENDING)
- [ ] Fix remaining TypeScript errors
- [ ] Add unit tests for data tools
- [ ] Update documentation

---

## 8. Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Database driver compatibility | High | Test with all supported databases |
| Tool interface mismatch | Medium | Create robust adapter layer |
| Permission system conflicts | Medium | Carefully integrate permission rules |
| Performance with large datasets | High | Add pagination, streaming support |
| Breaking existing CORINT Agent features | High | Comprehensive testing |

---

## 9. Conclusion

The integration strategy focuses on:

1. **Preserving CORINT Agent's strengths**: CLI, UI, tool framework, multi-model support
2. **Adding CORINT's domain capabilities**: Data source management, SQL tools, risk calculations
3. **Gradual integration**: Phase-based approach to minimize risk
4. **Clean architecture**: Adapter pattern for tool compatibility

The result will be a powerful Risk Agent CLI that combines:
- CORINT Agent's excellent developer experience
- CORINT's domain-specific risk management tools
- Multi-database support for enterprise data
- Planning and evaluation capabilities for complex tasks

---

**Document Version**: 1.0
**Created**: 2026-01-15
**Status**: Analysis Complete
