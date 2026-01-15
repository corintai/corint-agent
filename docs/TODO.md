# CORINT Risk Agent Development TODO

> Priority: **P0** = MVP 必须, **P1** = 重要但可延后, **P2** = 未来增强

---

## Phase 1: Project Foundation (P0) ✅

### 1.1 Project Setup
- [x] Initialize TypeScript monorepo with npm workspaces
- [x] Configure ESLint, Prettier, tsconfig
- [x] Setup build pipeline (esbuild/tsup)
- [x] Create package structure:
  - [x] `packages/agent-core`
  - [x] `packages/agent-tools`
  - [x] `packages/agent-skills`
  - [x] `packages/agent-cli`

### 1.2 LLM Integration
- [x] Implement LLM abstraction layer
- [x] Add OpenAI GPT-4 provider
- [x] Add Anthropic Claude provider
- [x] Add DeepSeek provider
- [x] Implement streaming response handling
- [x] Implement tool/function calling interface

---

## Phase 2: Agent Core (P0) ✅

### 2.1 Orchestrator (`orchestrator.ts`)
- [x] Main agent loop implementation
- [x] Message routing (user → planning → execution → evaluation)
- [x] Session lifecycle management
- [x] Async execution with progress updates
- [x] User interruption handling

### 2.2 Planning Module (`planner.ts`)
- [x] Intent classification
- [x] Task decomposition (goal → task list)
- [x] Dynamic plan revision:
  - [x] `decompose` mode
  - [x] `overwrite` mode
- [x] TODO list generation with dependencies

### 2.3 Execution Module (`executor.ts`)
- [x] Task Manager (status tracking, dependency resolution)
- [x] Tool registry and dispatcher
- [x] Retry mechanism (action-level, task-level)
- [x] Parallel executor (concurrent tool calls)

### 2.4 Evaluation Module (`evaluator.ts`)
- [x] Result synthesis
- [x] Confidence scoring (high/medium/low)
- [x] Validation & error detection
- [x] Plan adjustment trigger
- [x] User escalation logic

### 2.5 Context Manager
- [x] Session Memory (conversation history)
- [x] Working Memory (intermediate results, task state)
- [ ] User Profile (cross-session preferences)

### 2.6 Cost Controller
- [x] Token budget tracking (100K default)
- [x] Query limit enforcement (50/task)
- [x] Timeout control
- [x] Cost alerts and notifications

---

## Phase 3: Foundation Tools (P0)

### 3.1 Data Access Tools
- [x] `query_sql` - SQL query execution
  - [x] PostgreSQL connector
  - [x] MySQL connector
  - [x] ClickHouse connector
- [x] `explore_schema` - Schema introspection

### 3.2 File Tools
- [x] `read_file` - File reading (text, binary, Excel, CSV)
- [x] `write_file` - File writing
- [ ] `edit_file` - Precise string replacement editing

### 3.3 Search Tools
- [ ] `glob_files` - Pattern-based file search
- [ ] `grep_content` - Regex content search with context

### 3.4 Code Execution Tools
- [x] `execute_code` - Python code execution in sandbox
- [x] `run_bash` - Bash command execution
- [ ] Sandbox environment setup (Docker-based)

### 3.5 Web Tools
- [ ] `fetch_web` - Fetch and extract web content

### 3.6 Agent Tools
- [ ] `spawn_agent` - Create isolated sub-agent for parallel tasks
- [ ] `todo_write` - Update task list status for UI display

---

## Phase 4: Domain Calculation Tools (P0)

### 4.1 Model Metrics
- [ ] `calculate_metrics` - KS, AUC, PSI, IV, Gini

### 4.2 Risk Analysis
- [ ] `calculate_vintage` - Vintage matrix
- [ ] `calculate_dpd_distribution` - DPD distribution
- [ ] `calculate_flow_rate` - Flow rate matrix

### 4.3 Strategy Simulation
- [ ] `simulate_threshold` - Single threshold simulation
- [ ] `simulate_strategy` - Multi-threshold strategy simulation
- [ ] `backtest_rule` - Rule backtesting

### 4.4 RDL Validation
- [ ] `validate_rdl` - Syntax validation
- [ ] `validate_semantics` - Semantic validation

---

## Phase 5: Domain Action Tools (P1)

### 5.1 Deployment
- [ ] `deploy_config` - Config deployment to repository
- [ ] `rollback_config` - Version rollback
- [ ] Checkpoint mechanism implementation

### 5.2 Experimentation
- [ ] `create_ab_test` - A/B test creation
- [ ] `stop_ab_test` - A/B test termination

### 5.3 Reporting
- [ ] `export_report` - Report export (PDF, Excel, HTML)

---

## Phase 6: CLI Interface (P0)

### 6.1 Core CLI
- [x] Interactive REPL mode
- [x] Command parsing and routing
- [x] Streaming output display
- [x] Tool call visualization

### 6.2 User Experience
- [x] Progress indicators
- [x] Confirmation dialogs (for destructive operations)
- [x] History and session management
- [x] `/restore` command for checkpoint rollback

---

## Phase 7: Knowledge Base (P1)

### 7.1 Domain Knowledge
- [ ] Domain concepts repository (DPD, KS, AUC, Vintage...)
- [ ] RDL syntax & templates
- [ ] Strategy patterns library
- [ ] Best practices documentation

### 7.2 Project Config
- [ ] CORINT.md file parsing
- [ ] Project-specific context injection

### 7.3 Self-Evolution
- [ ] Knowledge ADD/MODIFY/DELETE operations
- [ ] User feedback learning loop

---

## Phase 8: Skills System (P1)

### 8.1 Skills Registry
- [ ] Skill discovery and loading
- [ ] Skill execution engine
- [ ] Natural language trigger matching

### 8.2 Built-in Skills
- [ ] `daily_report` - Risk daily report generation
- [ ] `rule_optimization` - Rule threshold optimization
- [ ] `vintage_analysis` - Vintage analysis report
- [ ] `strategy_comparison` - Multi-strategy comparison
- [ ] `anomaly_investigation` - Anomaly root cause analysis

### 8.3 Custom Skills
- [ ] Markdown skill file parser
- [ ] Skill validation
- [ ] Team skill sharing (repository integration)

---

## Phase 9: MCP Extensions (P1)

### 9.1 MCP Client
- [ ] MCP protocol implementation
- [ ] Server discovery and connection
- [ ] Dynamic tool registration

### 9.2 Data Source Connectors
- [ ] Spark SQL MCP server
- [ ] Snowflake MCP server
- [ ] Custom data source template

---

## Phase 10: Web API Server (P2)

### 10.1 API Server
- [ ] REST API endpoints
- [ ] WebSocket for streaming
- [ ] Authentication & authorization

### 10.2 Web UI
- [ ] Manus-like conversational interface
- [ ] Visualization components (charts, tables)
- [ ] Rule editor with syntax highlighting

---

## Phase 11: Testing & Quality (P0)

### 11.1 Unit Tests
- [ ] Agent core module tests
- [ ] Tool implementation tests
- [ ] LLM integration tests (mocked)

### 11.2 Integration Tests
- [ ] End-to-end workflow tests
- [ ] Data source connectivity tests

### 11.3 Evaluation
- [ ] Offline eval set creation
- [ ] Accuracy metrics tracking
- [ ] Regression testing pipeline

---

## Phase 12: Documentation (P1)

### 12.1 Developer Docs
- [ ] TOOL_SPECS.md - Tool specifications
- [ ] EXAMPLES.md - Usage examples
- [ ] API documentation

### 12.2 User Docs
- [ ] Getting started guide
- [ ] Skill authoring guide
- [ ] FAQ and troubleshooting

---

## Milestone Summary

| Milestone | Scope | Target |
|-----------|-------|--------|
| **M1: Core Loop** | Project setup + LLM integration + Basic orchestrator | - |
| **M2: Tool MVP** | Foundation tools + 2-3 domain tools + CLI | - |
| **M3: Full Tools** | All P0 tools + Retry mechanism + Cost control | - |
| **M4: Skills** | Skills system + Built-in skills | - |
| **M5: Production** | MCP + Checkpoint + Security + Logging | - |

---

**Last Updated**: 2026-01-12
