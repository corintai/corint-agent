# CORINT Risk Agent Requirements

## 1. Design References

### 1.0 Product Vision

> **Efficiently operate risk control business with one AI Agent + minimal core personnel.**
>
> Users care about **rules, metrics, strategies, and results** - not code.

### 1.1 Product References
- **Web UI**: Reference [Manus](https://www.manus.app/) conversational interaction experience
  - Natural language driven workflows
  - Visual result presentation
  - Multi-turn conversation context management

- **CLI**: Reference [Anthropic Claude Code](https://docs.anthropic.com/en/docs/agents) command line interaction
  - Interactive REPL mode
  - Transparent tool invocation
  - Scripting support

### 1.2 Agent Design Principles
> Reference interviews with Manus founders
- **Agent Architecture**: Composed of three parts: Brain (LLM), Environment (Sandbox + Runtime), Execution Tools (Tools)
- **Model-driven**: No preset manual rules or complex workflows; the model itself decides the task completion path
- **Planning Stage**: Dedicated planning phase to decompose complex tasks into multi-step plans, continuously adjusting based on environment feedback (Observation)
- **Coding & Tools Calling**: Can write code, debug, run, call APIs and tools to handle various long-tail tasks
- **Async Communication & Interruption**: No need for turn-by-turn Q&A; async task execution with progress sync, user intervention when necessary, users can interrupt to add info, change goals, or terminate tasks
- **Sandbox Cloud Isolation**: Allocate independent, isolated cloud virtualized environment per session for security and continuous long-chain task execution
- **Scale Out**: Through Wide Research and similar features, launch hundreds of Sandboxes to complete sub-tasks in parallel, then aggregate results for output exceeding individual human efficiency

> Reference Claude Skills
- Users can define custom Skills to extend Agent capabilities and constraint specifications

---

## 2. Target Users

### Primary Users
- **Risk Strategy Analysts**: Responsible for designing and optimizing risk control strategies
- **Risk Modeling Engineers**: Responsible for feature engineering and model development
- **Business Stakeholders**: Management and operations personnel focused on business metrics

### User Personas

**Alice (Strategy Analyst)**
- Daily analysis of approval rate and rejection rate changes, identifying anomalous rules, tuning thresholds
- User Stories:
  - As Alice, I want to ask "Why did the rejection rate increase by 5% yesterday", so that I can quickly identify problematic rules
  - As Alice, I want to say "Adjust rule R001 threshold to reduce false positive rate by 10%", so that I can optimize strategy without coding
  - As Alice, I want to ask "Compare rule trigger distribution between this week and last week", so that I can spot trends

**Bob (Modeling Engineer)**
- Needs to quickly validate new feature effectiveness, backtest strategy performance, deploy new rules
- User Stories:
  - As Bob, I want to say "Backtest this rule using the last 30 days of data", so that I can validate rule effectiveness
  - As Bob, I want to say "Generate a feature to detect multi-loan borrowing", so that I can quickly prototype new features
  - As Bob, I want to say "Deploy this ruleset to staging environment", so that I can test in real environment

**Carol (Business Manager)**
- Needs to view risk control reports, understand strategy impact, make business decisions
- User Stories:
  - As Carol, I want to ask "What is the impact of this month's risk strategy on approval rate", so that I can make informed decisions
  - As Carol, I want to ask "Generate a weekly risk performance report", so that I can share with stakeholders
  - As Carol, I want to ask "If we relax the threshold by 10%, how much will the bad debt rate increase", so that I can evaluate trade-offs

---

## 3. Application Scenarios

### 3.1 Primary Scenarios (Phase 1)

**Credit Risk Management** (Credit approval, limit management, overdue prediction)
- New user credit approval rule generation and optimization
- Existing user limit adjustment strategies
- Overdue warning rule configuration

**Fraud Detection** (Transaction anti-fraud, account takeover detection, fake identity identification)
- Abnormal transaction real-time interception rules
- Device fingerprint and behavioral feature analysis
- Gang fraud pattern recognition

### 3.2 Extended Scenarios (Future)
- **Payment Risk**: Payment fraud, money laundering detection
- **E-commerce Risk**: Malicious order brushing, fake reviews, account farming
- **Insurance Risk**: Insurance fraud detection, claims review

---

## 4. Core Objectives

### 4.1 User Experience Goal
Enable users to complete daily risk control work through natural language conversation like using **Manus**, without writing code or learning complex tools. See [Section 2 User Personas](#user-personas) for specific scenarios.

### 4.2 Technical Goals

| Goal | Description | Success Criteria |
|------|-------------|------------------|
| **DSL Generation** | Auto-generate CORINT RDL (Rules, Rulesets, Pipelines) | Syntax accuracy 100%, semantic accuracy ≥ 90% |
| **Iterative Workflow** | Support multi-turn conversation and iterative optimization | Single session supports ≥ 20 conversation turns |
| **Production-Ready** | Generated code can be deployed directly to production | Pass CI validation without manual modification |
| **Extensibility** | Support new data sources and tool extensions | Add new data source < 1 person-day |
| **Observability** | Full-chain traceability | Each request traceable to complete execution path |

---

## 5. Functional Requirements

### 5.1 Core Capabilities

> Priority: **P0** = MVP required, **P1** = Important but deferrable, **P2** = Future enhancement

#### 5.1.1 Risk Analysis
| Feature | Priority | Description |
|---------|----------|-------------|
| Query historical decision results | P0 | Approval rate, rejection rate, review rate queries |
| Analyze rule performance | P0 | Trigger rate, precision, false positive rate analysis |
| Root cause investigation | P0 | Why did a certain rule suddenly trigger more |
| Detect anomalies in features/metrics | P1 | Anomalous user, anomalous transaction detection |
| Pattern discovery | P2 | Discover potential fraud patterns |

#### 5.1.2 Strategy Generation & Optimization

> **Models are not the end goal, strategies are.**

| Feature | Priority | Description |
|---------|----------|-------------|
| Generate rules in RDL syntax | P0 | Generate rule code from natural language |
| Create rulesets and pipelines | P0 | Combine rules into complete strategies |
| Strategy simulation | P0 | Simulate approval rate/overdue/revenue under different thresholds |
| Strategy comparison | P0 | Compare multiple strategy options, recommend optimal |
| Optimize thresholds and weights | P1 | Auto-tune rule parameters |
| Generate feature definitions | P1 | Generate feature definition code |

#### 5.1.3 Testing & Validation
| Feature | Priority | Description |
|---------|----------|-------------|
| Syntax validation | P0 | RDL syntax check |
| Semantic validation | P0 | Rule logic validation |
| Backtest on historical data | P0 | Backtest strategy performance |
| A/B test framework | P1 | Strategy comparison experiments |

#### 5.1.4 Deployment & Monitoring
| Feature | Priority | Description |
|---------|----------|-------------|
| Deploy rules/rulesets to repository | P0 | Deploy to rule repository |
| Version control integration | P0 | Git version management |
| Real-time performance monitoring | P1 | Real-time performance monitoring |
| Alert on anomalies | P2 | Anomaly alerts |

#### 5.1.5 Reporting & BI

| Feature | Priority | Description |
|---------|----------|-------------|
| Daily report generation | P0 | Auto-generate daily reports (loan amount, approval rate, DPD distribution, etc.) |
| Business metrics dashboard | P0 | Core business metrics dashboard |
| Vintage analysis | P1 | Aging analysis, overdue trends |
| Channel ROI analysis | P1 | Channel effectiveness comparison |
| Strategy before/after comparison | P1 | Strategy pre/post launch effect comparison |

### 5.2 Data Source Support

Agent needs to support multiple data sources for analysis, feature engineering, and rule generation.

| Category | Supported | Primary Use Cases |
|----------|-----------|-------------------|
| **Relational DB** | PostgreSQL, MySQL, MariaDB | Historical decision queries, user behavior analysis, rule backtesting |
| **OLAP** | ClickHouse | Large-scale aggregation analysis, time-series features, real-time monitoring |
| **Big Data** | Apache Spark (PySpark, Spark SQL) | TB-level data processing, complex feature engineering, distributed backtesting |
| **Local Files** | Excel, CSV, TXT | External data import, test data validation |
| **API** | REST, GraphQL, gRPC (optional) | External risk services, third-party data sources, real-time features |
| **Cloud Platform** | Snowflake, Databricks | Cloud data warehouse queries, cross-platform analysis |

**Common Capabilities:**
- Schema introspection & auto-discovery
- Query generation from natural language
- Connection pooling & authentication
- Read-only mode for production environments

### 5.3 Data Quality Management

Agent can automatically identify problematic data based on data specifications and perform cleaning, ensuring analysis and strategies are based on clean, reliable data.

| Feature | Priority | Description |
|---------|----------|-------------|
| Schema understanding | P0 | Understand table structure, field types, business meaning |
| Anomaly detection | P0 | Auto-identify outliers, missing values, format errors, logical conflicts |
| Data cleaning suggestion | P0 | Propose cleaning suggestions for problematic data (delete/fill/correct) |
| Cleaning execution | P1 | Execute cleaning operations, generate clean datasets |
| Quality report | P1 | Generate data quality reports (issue distribution, cleaning statistics) |


---

## 6. Interface Requirements

### 6.1 CLI (Command Line Interface)
- **Target Users**: Engineers and power users
- **Features**:
  - Interactive chat mode
  - Command history
  - Pipeline execution
  - Scripting support

### 6.2 Web UI (Console & Dashboard)
- **Target Users**: Analysts and business users
- **Features**:
  - Visual conversation interface
  - Chart/table visualization
  - Rule editor with syntax highlighting
  - Workflow templates

---

## 7. Non-Functional Requirements

### 7.1 Reliability

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Result Acceptance Rate | ≥ 80% | User thumbs up/down feedback statistics |
| Task Completion Rate | ≥ 95% | Task status tracking (success/failure/timeout) |
| First-time Success Rate | ≥ 70% | Percentage usable without user correction |
| Average Task Duration | < 30s (simple) / < 5min (complex) | Task timer |

**Error Handling:**
- Error Recovery: Graceful degradation or prompt user intervention on errors
- Timeout Handling: Long-running tasks need progress feedback to avoid appearing stuck (show progress after >10s)
- Operation Atomicity: Deployment operations either fully succeed or fully rollback
- Retry Strategy: Auto-retry retriable errors (max 3 times, exponential backoff)

### 7.2 Security
- Authentication & Authorization (Role-based access control)
- Audit logging (All operations logged)
- Data privacy (Sensitive data anonymization)
- No credential exposure in generated code

### 7.3 Explainability
- **Reasoning Trace**: Show intermediate reasoning steps and decision basis
- **Data Provenance**: Annotate data sources (which table, which time period)
- **Confidence Score**: Annotate confidence level (high/medium/low) for generated results
- **Alternative Options**: Provide alternatives when confidence is low
- **Query Preview**: Show SQL/code before execution, allow user confirmation

### 7.4 Maintainability
- **Skills Support**: Support user-defined Skills (reference Claude Skills)
- **Plugin Architecture**: Pluggable tool and data source extensions
- **Configuration Management**: Support multi-environment configuration (dev/staging/prod)
- **Logging & Debugging**: Detailed execution logs for troubleshooting

---


## 8. Constraints & Assumptions

### 8.1 Technical Constraints
- Implement the Agent in TypeScript
- Must generate valid RDL syntax
- Cannot modify production data directly

### 8.2 Business Constraints
- Initial focus on credit risk
- Response in user's language, default English
- Deployment requires human approval

### 8.3 Out of Scope (Phase 1)
The following features are not in MVP scope:
- **Model Training**: No machine learning model training, only rule strategies
- **Real-time Streaming**: No real-time stream processing, only batch queries
- **Multi-tenancy**: Initial version does not support multi-tenant isolation
- **Mobile App**: Only Web UI and CLI, no mobile app
- **Automated Deployment**: Deployment requires human approval, no fully automated deployment
- **External Integrations**: No integration with external BI tools (e.g., Tableau, Metabase)

---

## 9. Agent Runtime Requirements

### 9.1 Context & Memory Management
- **Session Context**: Maintain complete conversation history within a single session
- **Working Memory**: Intermediate state related to current task (query results, generated code, etc.)
- **Long-term Memory**: Cross-session user preferences, commonly used rule templates (optional, P2)

### 9.2 Human-in-the-Loop
| Scenario | Behavior |
|----------|----------|
| Ambiguous input | Proactively ask for clarification, provide options |
| High-risk operations (deploy, delete) | Must confirm with user before execution |
| Low-confidence results | Annotate confidence, suggest human review |
| Long-running tasks | Periodically sync progress, allow user to interrupt or modify goals |

### 9.3 Tool Invocation Transparency
- Display currently invoked tool name and parameters
- Show tool execution result summary
- Support expanding to view complete input/output (collapsible)

### 9.4 Cost Control
- **Token Budget**: Single conversation token limit (default 100K, configurable)
- **Query Limit**: Single task database query limit (default 50 queries)
- **Timeout**: Single tool call timeout (default 180s), overall task timeout (default 60min)

---

## 10. Success Metrics

| Metric | Definition | Target (6 months) |
|--------|------------|-------------------|
| Task Success Rate | Percentage of tasks completed with user satisfaction | ≥ 75% |
| Time Saved | Time saved compared to manual operations | ≥ 90% |
| Rule Quality Score | Precision/recall of generated rules | On par with manual |
