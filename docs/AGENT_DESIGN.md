# CORINT Risk Agent Design

## Executive Summary

> **用一个 AI Agent + 极少量核心人员，高效运营风控业务。**
>
> 用户只关心**规则、指标、策略和结果**，不关心代码。

CORINT Risk Agent is an AI-native assistant designed for risk management professionals, enabling natural language interaction with the CORINT decision engine for risk analysis, strategy optimization, model iteration, anomaly detection, and data analytics.

**Design Philosophy**: Model-driven, Tool-centric, Sandbox-isolated, Skills-first

**Target Users**: 
- **Risk Strategy Analysts**: Design and optimize risk strategies
- **Risk Modeling Engineers**: Feature engineering and model development
- **Business Stakeholders**: Monitor metrics and make decisions

**Application Scenarios**:
- **Credit Risk Management** (Priority): Credit approval, limit management, overdue prediction
- **Fraud Detection**: Transaction fraud, account takeover, identity fraud

**User Experience**: 
- **Web UI**: Manus-like conversational interface
- **CLI**: Claude Code-style interactive terminal

---

## 1. Design Principles

### 1.1 Core Principles (Aligned with REQUIREMENT.md)

1. **Agent Architecture**
   - Brain (LLM), Environment (Sandbox + Runtime), Tools
   - Clear boundaries between reasoning, execution, and environment

2. **Model-driven**
   - The model decides the task path; avoid pre-set workflows
   - Deterministic workflows are optional and policy-driven

3. **Planning Stage**
   - Explicit planning step for complex tasks
   - Iterate Plan -> Observation -> Adjustment

4. **Coding & Tool Calling**
   - Agent can write code, debug, run, and call tools/APIs
   - Covers long-tail tasks beyond fixed workflows

5. **Async Communication & Interruptions**
   - Async execution with progress updates
   - User can interrupt, modify goals, or terminate tasks

6. **Sandbox Cloud Isolation**
   - Isolated sandbox per session for safety and continuity
   - Supports long-running chains of work

7. **Scale Out**
   - Parallel sub-tasks across multiple sandboxes
   - Aggregate results with traceable provenance

8. **Skills Support**
   - Users define Skills to extend capabilities and constraints

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    User Interface Layer                      │
│                                                               │
│       ┌─────────────────┐       ┌─────────────────┐         │
│       │    CLI Tool     │       │     Web UI      │         │
│       │ (Claude Code)   │       │ (Manus-like)    │         │
│       └────────┬────────┘       └────────┬────────┘         │
│                │                         │                   │
└────────────────┼─────────────────────────┼───────────────────┘
                 │                         │
                 └────────────┬────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  CORINT Risk Agent Core                      │
│                                                               │
│  ┌───────────────────────┐  ┌────────────────────────────┐  │
│  │   Context Manager     │  │      Cost Controller       │  │
│  │  • Session Memory     │  │  • Token Budget            │  │
│  │  • Working Memory     │  │  • Query Limit             │  │
│  │  • User Profile       │  │  • Timeout Control         │  │
│  └───────────────────────┘  └────────────────────────────┘  │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                   Knowledge Base                     │    │
│  │  • Domain Concepts (DPD, KS, AUC, Vintage...)       │    │
│  │  • RDL Syntax & Templates                            │    │
│  │  • Strategy Patterns & Best Practices                │    │
│  │  • Self-Evolution (learn from user feedback)         │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                               │
│  ┌────────────────────────────────────────────────────┐     │
│  │                   Planning Module                   │     │
│  │  - Intent/Risk Assessment                           │     │
│  │  - Task Planning & Decomposition                    │     │
│  │  - Dynamic Plan Revision (decompose/overwrite)      │     │
│  └────────────────────────────────────────────────────┘     │
│                         │         ▲                          │
│                         ▼         │ (revise)                 │
│  ┌────────────────────────────────┴───────────────────┐     │
│  │                   Execution Module                  │     │
│  │                                                      │     │
│  │  ┌──────────────────────────────────────────────┐  │     │
│  │  │  Task Manager │ Sandbox Manager │ Parallel   │  │     │
│  │  │  (TODO, deps) │ (isolated env)  │ Executor   │  │     │
│  │  └──────────────────────────────────────────────┘  │     │
│  │                                                      │     │
│  │  ┌──────────────────────────────────────────────┐  │     │
│  │  │              Agent Tools                      │  │     │
│  │  │  • Foundation Tools (基础访问)                 │  │     │
│  │  │  • Domain Calculation Tools (领域计算)         │  │     │
│  │  │  • Domain Action Tools (领域操作)              │  │     │
│  │  │  • MCP Extensions (外部数据源/服务)            │  │     │
│  │  │  • User-defined Skills                        │  │     │
│  │  └──────────────────────────────────────────────┘  │     │
│  └────────────────────────────────────────────────────┘     │
│                         │                                    │
│                         ▼                                    │
│  ┌────────────────────────────────────────────────────┐     │
│  │                  Evaluation Module                  │     │
│  │  - Result Synthesis & Confidence Scoring            │     │
│  │  - Validation & Uncertainty Handling                │     │
│  │  - Plan Adjustment or User Escalation               │     │
│  └────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│              CORINT Decision Engine Stack                    │
│       Deploy strategies for A/B Test or Shadow Test          │
│                                                              │
│       ┌─────────────────┐       ┌─────────────────┐         │
│       │    Decision     │       │   Repository    │         │
│       │     Engine      │       │     (RDL)       │         │
│       └─────────────────┘       └─────────────────┘         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Architecture Notes**:
- **Context Manager**: Maintains conversation context across turns:
  - **Session Memory**: Current conversation history
  - **Working Memory**: Intermediate results and task state
  - **User Profile**: Persistent user preferences and habits (cross-session)
- **Cost Controller**: Enforces token budget (100K default), query limits (50/task), and timeouts.
- **Knowledge Base**: Risk domain knowledge repository with multiple layers:
  - **Project Config (CORINT.md)**: Project-specific context file describing data sources, naming conventions, and business rules
  - **Domain Concepts**: DPD, overdue rate, KS, AUC, Vintage, flow rate definitions
  - **RDL Syntax**: CORINT DSL grammar, Rule/Ruleset/Pipeline templates
  - **Strategy Patterns**: Common rule patterns (multi-loan detection, high-risk region, credit limit tiers)
  - **Feature Templates**: Behavioral, device, graph feature calculation logic
  - **Best Practices**: Threshold tuning experience, regulatory compliance constraints
  - **Self-Evolution**: Learn from user feedback via ADD/MODIFY/DELETE operations on knowledge
- **Task Manager**: Converts plans into TODO lists with dependencies and status tracking.
- **Sandbox Manager**: Allocates isolated cloud environments per session for safety and continuity.
- **Parallel Executor**: Enables scale-out sub-tasks across multiple sandboxes with result aggregation.
- **Agent Tools**: Managed by Execution Module; includes Foundation, Domain Calculation, Domain Action tools, MCP extensions, and user-defined Skills.
- **MCP Extensions**: Support Model Context Protocol for pluggable data sources and external services. MCP servers can be configured to provide additional tools dynamically.
- **Dynamic Plan Revision**: Execution can trigger plan adjustments via two modes:
  - **decompose**: Break current task into smaller sub-tasks when complexity is discovered
  - **overwrite**: Replace remaining plan while preserving completed tasks when original plan is infeasible

### 2.1 Task Status

| Status | Description |
|--------|-------------|
| `pending` | Task not yet started |
| `running` | Task currently executing |
| `completed` | Task finished successfully |
| `failed` | Task execution failed |
| `blocked` | Waiting for user input or confirmation |

### 2.2 Retry Mechanism

| Level | Max Retries | Strategy | Trigger |
|-------|-------------|----------|---------|
| Action | 3 | Exponential backoff | Tool execution failure, invalid response format |
| Task | 10 (total) | Re-plan or escalate | Repeated action failures |
| Session | N/A | User notification | Token budget exceeded, timeout |

### 2.3 Checkpoint Mechanism

Auto-save state before destructive operations, enabling rollback:

| Checkpoint Type | Trigger | Stored Content |
|-----------------|---------|----------------|
| Config Checkpoint | Before `deploy_config` | Previous config version, deployment metadata |
| Rule Checkpoint | Before rule modification | Original RDL content, validation results |
| Session Checkpoint | Periodic (every N actions) | Task state, working memory, tool call history |

**Rollback**: User can restore to any checkpoint via `rollback_config` tool or `/restore` command.


---

## 3. Built-in Tools

### 3.1 Tool Design Philosophy

**工具边界原则**：
- **工具负责**：执行确定性操作、访问外部系统、执行复杂计算、返回结构化数据
- **LLM 负责**：推理、分析、建议、决策、对比、归因

**工具选择策略**：
- **内置工具优先**：优先使用预定义的领域工具，保证执行效率和结果一致性
- **代码兜底**：当内置工具无法满足需求时，Agent 可编写代码解决长尾问题
- **沙盒隔离**：所有代码在隔离沙盒中执行，确保安全

**不应成为工具的能力**：
- `root_cause_analysis` → LLM 根据数据自己推理
- `recommend_strategy` → LLM 根据模拟结果自己推荐
- `suggest_cleaning` → LLM 看到数据问题后自己建议
- `detect_anomalies` → LLM 看统计数据后自己判断
- `compare_strategies` → LLM 看到多个策略的指标后自己对比

### 3.2 Foundation Tools (基础访问)

最底层的原子工具，提供数据访问、文件操作、搜索、子Agent调用和代码执行能力。

#### 3.2.1 Data Access Tools (数据访问)

| Tool | Purpose | Input | Output |
|------|---------|-------|--------|
| `explore_schema` | 获取表结构、字段、注释 | `table_name`, `data_source` | Schema JSON |
| `query_sql` | 执行 SQL 查询 | `sql`, `data_source` | DataFrame / JSON |

**支持的数据源**：PostgreSQL, MySQL, ClickHouse, Spark SQL, Snowflake, Hive 等

#### 3.2.2 File Tools (文件操作)

| Tool | Purpose | Input | Output |
|------|---------|-------|--------|
| `read_file` | 读取本地文件 | `file_path`, `offset?`, `limit?` | Content (text/binary) |
| `write_file` | 写入/创建文件 | `file_path`, `content` | Success / Fail |
| `edit_file` | 精确编辑文件 | `file_path`, `old_string`, `new_string` | Success / Fail |

#### 3.2.3 Search Tools (搜索工具)

| Tool | Purpose | Input | Output |
|------|---------|-------|--------|
| `glob_files` | 模式匹配搜索文件 | `pattern`, `path?` | File path list |
| `grep_content` | 正则搜索文件内容 | `pattern`, `path?`, `include?` | Matches with context |

#### 3.2.4 Execution Tools (执行工具)

| Tool | Purpose | Input | Output |
|------|---------|-------|--------|
| `execute_code` | 在沙盒中执行代码 | `language`, `code` | Execution result |
| `run_bash` | 执行 Bash 命令 | `command`, `working_dir` | stdout / stderr |

#### 3.2.5 Web Tools (网络工具)

| Tool | Purpose | Input | Output |
|------|---------|-------|--------|
| `fetch_web` | 获取网页内容 | `url`, `prompt` | Extracted content |

#### 3.2.6 Agent Tools (Agent 工具)

| Tool | Purpose | Input | Output |
|------|---------|-------|--------|
| `spawn_agent` | 创建隔离子Agent执行任务 | `agent_type`, `prompt`, `model?` | Agent result |
| `todo_write` | 更新任务列表状态 | `todos[]` | Updated list |

**说明**：

- **数据访问**：LLM 负责根据需求生成正确的 SQL；`fetch_web` 用于获取外部文档或网页信息
- **文件操作**：`edit_file` 使用精确字符串匹配替换，避免重写整个文件；`read_file` 支持分页读取大文件
- **搜索工具**：`glob_files` 用于快速定位文件，`grep_content` 用于搜索代码内容，两者配合减少 token 消耗
- **执行工具**：`execute_code` 优先使用 Python（数据分析生态丰富），用于处理内置工具无法覆盖的长尾需求；`run_shell` 用于执行系统命令，需在沙盒环境中运行
- **Agent 工具**：
  - `spawn_agent` 创建隔离的子会��，支持并行执行多个子任务，子Agent 有独立的上下文和 token 预算
  - `todo_write` 用于 UI 状态管理，实时展示任务进度给用户，非文件写入操作

### 3.3 Domain Calculation Tools (领域计算)

封装风控领域的**确定性计算逻辑**，这些计算 LLM 无法自己完成。

| Tool | Purpose | Input | Output |
|------|---------|-------|--------|
| `calculate_metrics` | 计算模型评估指标 | `predictions`, `labels`, `metrics[]` | KS / AUC / PSI / IV / Gini |
| `calculate_vintage` | 计算账龄分析矩阵 | `loan_data`, `observation_months` | Vintage Matrix |
| `calculate_dpd_distribution` | 计算 DPD 逾期分布 | `repayment_data`, `bucket_days[]` | DPD Histogram |
| `calculate_flow_rate` | 计算迁徙率 | `collection_data`, `periods` | Flow Rate Matrix |
| `simulate_threshold` | 模拟单阈值效果 | `score_data`, `threshold` | PassRate / BadRate / Volume |
| `simulate_strategy` | 模拟多阈值策略效果 | `score_data`, `strategy_config` | Segment-level metrics |
| `backtest_rule` | 规则历史回测 | `rule_definition`, `historical_data` | HitRate / Precision / Recall |
| `validate_rdl` | RDL 语法校验 | `rdl_content` | Valid / Syntax Errors |
| `validate_semantics` | RDL 语义校验 | `rdl_content`, `schema` | Valid / Semantic Errors |

### 3.4 Domain Action Tools (领域操作)

执行有副作用的领域操作，通常需要用户确认。

| Tool | Purpose | Input | Output |
|------|---------|-------|--------|
| `deploy_config` | 部署配置到仓库 | `config`, `env`, `version` | Deployment Result |
| `rollback_config` | 回滚到指定版本 | `config_name`, `target_version` | Rollback Result |
| `create_ab_test` | 创建 A/B 实验 | `variants[]`, `traffic_split` | Experiment ID |
| `stop_ab_test` | 停止 A/B 实验 | `experiment_id` | Stop Result |
| `export_report` | 导出报告文件 | `content`, `format`, `path` | File Path |

### 3.5 Tool Execution Flow

```
User Request
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│                        LLM                               │
│  1. 理解用户意图                                          │
│  2. 规划执行步骤                                          │
│  3. 生成 SQL / 选择工具                                   │
│  4. 解读工具返回结果                                      │
│  5. 推理、分析、给出建议                                  │
└─────────────────────────────────────────────────────────┘
    │
    ▼ (Tool Calls)
┌─────────────────────────────────────────────────────────┐
│               Foundation Tools                           │
│  query_sql → 获取原始数据                                │
│  explore_schema → 理解数据结构                           │
└─────────────────────────────────────────────────────────┘
    │
    ▼ (如需复杂计算)
┌─────────────────────────────────────────────────────────┐
│            Domain Calculation Tools                      │
│  calculate_metrics → 获取 KS/AUC                        │
│  simulate_threshold → 获取不同阈值效果                   │
│  backtest_rule → 获取规则回测结果                        │
└─────────────────────────────────────────────────────────┘
    │
    ▼ (LLM 分析结果，给出建议)
┌─────────────────────────────────────────────────────────┐
│                        LLM                               │
│  "根据回测结果，建议将阈值从 0.6 调整到 0.55，           │
│   预计通过率提升 3%，坏账率仅增加 0.2%"                  │
└─────────────────────────────────────────────────────────┘
    │
    ▼ (用户确认后)
┌─────────────────────────────────────────────────────────┐
│              Domain Action Tools                         │
│  deploy_config → 部署新策略                              │
└─────────────────────────────────────────────────────────┘
```

## 4. Skills Design

### 4.1 Skills vs Tools

| | Tools | Skills |
|---|-------|--------|
| 来源 | 系统内置 | 用户定义 |
| 粒度 | 原子操作 | 组合工作流 |
| 扩展性 | 需开发 | Markdown 配置 |
| 示例 | query_sql, backtest_rule | 日报生成, 规则优化流程 |

### 4.2 Built-in Skills

| Skill | Description | 典型触发 |
|-------|-------------|----------|
| `daily_report` | 生成风控日报（放款、通过率、DPD 分布） | "生成今日风控报告" |
| `rule_optimization` | 规则阈值优化流程（回测→分析→建议） | "优化规则 R001 的阈值" |
| `vintage_analysis` | 账龄分析报告 | "分析 2024Q1 放款的逾期表现" |
| `strategy_comparison` | 多策略效果对比 | "对比这三个策略方案" |
| `anomaly_investigation` | 指标异常根因分析 | "为什么昨天拒绝率上升了" |

### 4.3 Custom Skills

用户可定义自己的 Skills 扩展 Agent 能力：

- **格式**: Markdown 文件描述工作流程、输入输出、示例对话
- **存储**: 本地目录或团队共享仓库
- **调用**: 通过自然语言触发或显式命令调用

**典型自定义场景**:
- 特定渠道的分析流程
- 公司内部的合规检查流程
- 定制化的报告模板

---

## 5. Technical Stack

### Core Components
- **Language**: TypeScript (Node.js runtime)
- **LLM Integration**:
  - OpenAI GPT-4 Turbo (primary)
  - Anthropic Claude 3.5 Sonnet (alternative)
  - DeepSeek (cost-effective option)
- **Tool Execution**: Async/await with native Promise 

### Architecture Modules
```
corint-cognition/
├── packages/
│   ├── agent-core/               # Agent orchestrator
│   │   ├── orchestrator.ts       # Main agent loop
│   │   ├── planner.ts            # Planning Module
│   │   ├── executor.ts           # Execution Module
│   │   └── evaluator.ts          # Evaluation Module
│   ├── agent-tools/              # Tool implementations
│   │   ├── foundation/           # Foundation tools
│   │   ├── calculation/          # Domain calculation tools
│   │   ├── action/               # Domain action tools
│   │   └── mcp/                  # MCP protocol extensions
│   ├── agent-skills/             # Skills registry and executor
│   ├── agent-cli/                # CLI interface
│   └── agent-server/             # Web API (future)
├── config/
│   └── agent.yaml                # Agent configuration
└── docs/
    ├── AGENT_DESIGN.md           # This file
    ├── TOOL_SPECS.md             # Tool specifications
    └── EXAMPLES.md               # Usage examples
```

---

## 6. Non-Functional Requirements

### 6.1 Reliability

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Result Acceptance Rate | ≥ 80% | 用户对生成结果的 👍/👎 反馈统计 |
| Task Completion Rate | ≥ 95% | 任务状态跟踪（成功/失败/超时） |
| First-time Success Rate | ≥ 70% | 无需用户修正即可使用的比例 |

**Error Handling:**
- Error Recovery: 遇到错误时优雅降级或提示用户干预
- Timeout Handling: 长时间任务需要进度反馈，避免卡死假象（>10s 显示进度）
- Operation Atomicity: 部署操作要么全部成功要么全部回滚
- Retry Strategy: 可重试错误自动重试（最多 3 次，指数退避）

### 6.2 Security
- Authentication & Authorization (Role-based access control)
- Audit logging (All operations logged)
- Data privacy (Sensitive data anonymization)
- No credential exposure in generated code

### 6.3 Explainability
- **Reasoning Trace**: 展示中间推理步骤和决策依据
- **Data Provenance**: 标注数据来源（哪个表、哪个时间段）
- **Confidence Score**: 对生成结果标注置信度（高/中/低）
- **Alternative Options**: 低置信度时提供备选方案
- **Query Preview**: 执行查询前展示 SQL/代码，允许用户确认

### 6.4 Maintainability
- **Skills Support**: 支持用户自定义 Skills（参考 Claude Skills）
- **Plugin Architecture**: 工具和数据源可插拔扩展
- **Configuration Management**: 支持多环境配置（dev/staging/prod）
- **Logging & Debugging**: 详细的执行日志，支持问题排查

---

## 7. Success Metrics

### 7.1 Efficiency Metrics
- **Time to Insight**: Reduce analysis time from hours to minutes
- **Iteration Speed**: Enable 10x faster rule optimization cycles
- **Automation Rate**: Automate 70% of routine analysis tasks

### 7.2 Quality Metrics
- **Rule Quality**: Generated rules pass validation 95%+ of time
- **Recommendation Acceptance Rate**: 80%+ of Agent suggestions accepted by users
- **User Satisfaction**: NPS score > 50

### 7.3 Adoption Metrics
- **Daily Active Users**: Target 80% of risk team
- **Tasks Automated**: Track # of analyses, generations, deployments
- **Skills Usage**: Measure built-in vs custom Skills adoption

### 7.4 Evaluation & Acceptance
- **Offline Eval Set**: Curated tasks with expected outputs (rules, insights, metrics)
- **Regression Gate**: Block releases that degrade acceptance or accuracy
- **Human Review Loop**: Sampled outputs reviewed weekly with feedback labels

---

## 8. Comparison: Risk Agent vs Other AI Agents

| Feature | CORINT Risk Agent | Manus | Claude Code | Cursor |
|---------|------------------|-------|-------------|--------|
| **Domain** | Risk Management | General Purpose | Code Generation | Code Editing |
| **Interface** | CLI + Web UI | Web UI | CLI | IDE Extension |
| **DSL Generation** | CORINT RDL (YAML) | N/A | Multiple languages | Multiple languages |
| **Data Analysis** | Built-in (SQL, metrics) | Limited | Limited | Limited |
| **Backtesting** | Native support | N/A | N/A | N/A |
| **Tool Ecosystem** | Risk-specific tools | General tools | Code tools | IDE tools |
| **Production Deploy** | Integrated with engine | N/A | N/A | N/A |
| **Explainability** | First-class (risk audit) | General | Code comments | Code suggestions |
| **Skills Support** | Built-in + Custom | N/A | N/A | N/A |
| **Target Users** | Risk analysts, engineers | Everyone | Developers | Developers |

---

## 9. Future Enhancements

### Short-term (3 months)
- Multi-agent collaboration (analysis agent + generation agent)
- Advanced visualization (decision trees, feature importance plots)
- Integration with Slack/Teams for notifications
- Scheduled reports and monitoring

### Long-term (6-12 months)
- Autonomous strategy optimization (continuous learning)
- Graph analysis tools (fraud rings, account networks)
- Model training and feature engineering automation
- Multi-tenant support for enterprise deployments

---

## References


1. CORINT Decision Engine Architecture - `../corint-decision/docs/ARCHITECTURE.md`
2. CORINT DSL Design - `../corint-decision/docs/DSL_DESIGN.md` 

---

**Document Version**: 1.0  
**Last Updated**: 2026-01-12  
**Status**: Design Phase