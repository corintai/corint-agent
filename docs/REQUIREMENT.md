# CORINT Risk Agent Requirements

## 1. Design References

### 1.0 Product Vision

> **用一个 AI Agent + 极少量核心人员，高效运营风控业务。**
>
> 用户只关心**规则、指标、策略和结果**，不关心代码。

### 1.1 Product References
- **Web UI**: 参考 [Manus](https://www.manus.app/) 的对话式交互体验
  - 自然语言驱动的工作流
  - 可视化结果展示
  - 多轮对话上下文管理
  
- **CLI**: 参考 [Anthropic Claude Code](https://docs.anthropic.com/en/docs/agents) 的命令行交互方式
  - 交互式 REPL 模式
  - 工具调用透明化
  - 支持脚本化执行

### 1.2 Agent Design Principles
>参考Manus两位创始人的访谈
- **Agent架构**：由三部分组成；大脑（LLM），环境（Sandbox+Runtime），执行工具（Tools）
- **Model-driven**: 不预设人工规则或复杂的工作流（Workflow），而是主张由大模型本身决定完成任务的路径
- **Planning Stage**: 有单独的规划阶段，将复杂任务拆解为多步计划（Plan），并根据环境反馈（Observation）不断调整。
- **Coding & Tools Calling**：能自己写代码、调试、运行，调用API 以及工具，从而能胜任各种长尾任务
- **异步通信与插嘴机制**：不需要问一句回一句，而是异步执行任务并同步进度，在必要时请求用户介入，在执行过程中用户也可以随时插嘴补充信息、改变目标或终止任务。
- **Sandbox云端沙盒机制**：为每个会话分配一个独立、隔离的云端虚拟化环境，从而保证安全性并方便Agent持续执行长链路的任务
- **Scale Out**： 通过Wide Research等功能，可以启动上百个Sandbox并行完成子任务，最后进行汇总，实现超越人类单体效率的产出

> 参考Claude Skills
- 用户可以自定义自己的Skills，用来进行Agent能力的扩展和约束规范

---

## 2. Target Users

### Primary Users
- **Risk Strategy Analysts**: 负责设计和优化风控策略的分析师
- **Risk Modeling Engineers**: 负责特征工程和模型开发的工程师
- **Business Stakeholders**: 管理层和运营人员，关注业务指标

### User Personas

**Alice (Strategy Analyst)**
- 每天需要分析通过率、拒绝率变化，找出异常规则，调优阈值
- User Stories:
  - As Alice, I want to ask "为什么昨天拒绝率上升了 5%", so that I can quickly identify problematic rules
  - As Alice, I want to say "调整规则 R001 的阈值，使误伤率降低 10%", so that I can optimize strategy without coding
  - As Alice, I want to ask "对比本周和上周的规则触发分布", so that I can spot trends

**Bob (Modeling Engineer)**
- 需要快速验证新特征效果，回测策略表现，部署新规则
- User Stories:
  - As Bob, I want to say "用最近 30 天数据回测这条规则", so that I can validate rule effectiveness
  - As Bob, I want to say "生成一个检测多头借贷的特征", so that I can quickly prototype new features
  - As Bob, I want to say "将这个 ruleset 部署到 staging 环境", so that I can test in real environment

**Carol (Business Manager)**
- 需要查看风控报表，理解策略影响，做业务决策
- User Stories:
  - As Carol, I want to ask "本月风控策略对通过率的影响是多少", so that I can make informed decisions
  - As Carol, I want to ask "生成一份本周风控表现报告", so that I can share with stakeholders
  - As Carol, I want to ask "如果放宽阈值 10%，预计坏账率会增加多少", so that I can evaluate trade-offs

---

## 3. Application Scenarios

### 3.1 Primary Scenarios (Phase 1)

**Credit Risk Management** (信贷审批、额度管理、逾期预测)
- 新用户授信审批规则生成与优化
- 存量用户额度调整策略
- 逾期预警规则配置

**Fraud Detection** (交易反欺诈、账户盗用检测、虚假身份识别)
- 异常交易实时拦截规则
- 设备指纹与行为特征分析
- 团伙欺诈模式识别

### 3.2 Extended Scenarios (Future)
- **Payment Risk**: 支付欺诈、洗钱检测
- **E-commerce Risk**: 恶意刷单、虚假评论、账号养号
- **Insurance Risk**: 骗保检测、理赔审核

---

## 4. Core Objectives

### 4.1 User Experience Goal
让用户能够像使用 **Manus** 一样，通过自然语言对话完成日常风控工作，无需编写代码或学习复杂工具。具体场景见 [Section 2 User Personas](#user-personas)。

### 4.2 Technical Goals

| Goal | Description | Success Criteria |
|------|-------------|------------------|
| **DSL Generation** | 自动生成 CORINT RDL（Rules, Rulesets, Pipelines） | 语法正确率 100%，语义正确率 ≥ 90% |
| **Iterative Workflow** | 支持多轮对话、迭代优化 | 单次会话支持 ≥ 20 轮对话 |
| **Production-Ready** | 生成的代码可直接部署到生产环境 | 无需人工修改即可通过 CI 校验 |
| **Extensibility** | 支持新数据源和工具扩展 | 新增数据源 < 1 人天 |
| **Observability** | 全链路可追踪 | 每个请求可追溯完整执行路径 |

---

## 5. Functional Requirements

### 5.1 Core Capabilities

> Priority: **P0** = MVP必须, **P1** = 重要但可延后, **P2** = 未来增强

#### 5.1.1 Risk Analysis
| Feature | Priority | Description |
|---------|----------|-------------|
| Query historical decision results | P0 | 通过率、拒绝率、审核率查询 |
| Analyze rule performance | P0 | 触发率、精准率、误报率分析 |
| Root cause investigation | P0 | 为什么某条规则突然触发增多 |
| Detect anomalies in features/metrics | P1 | 异常用户、异常交易检测 |
| Pattern discovery | P2 | 发现潜在欺诈模式 |

#### 5.1.2 Strategy Generation & Optimization

> **模型不是终点，策略才是。**

| Feature | Priority | Description |
|---------|----------|-------------|
| Generate rules in RDL syntax | P0 | 根据自然语言生成规则代码 |
| Create rulesets and pipelines | P0 | 组合规则为完整策略 |
| Strategy simulation | P0 | 模拟不同阈值下的通过率/逾期/收益 |
| Strategy comparison | P0 | 多策略方案对比，推荐最优方案 |
| Optimize thresholds and weights | P1 | 自动调优规则参数 |
| Generate feature definitions | P1 | 生成特征定义代码 |

#### 5.1.3 Testing & Validation
| Feature | Priority | Description |
|---------|----------|-------------|
| Syntax validation | P0 | RDL 语法检查 |
| Semantic validation | P0 | 规则逻辑校验 |
| Backtest on historical data | P0 | 回测策略表现 |
| A/B test framework | P1 | 策略对比实验 |

#### 5.1.4 Deployment & Monitoring
| Feature | Priority | Description |
|---------|----------|-------------|
| Deploy rules/rulesets to repository | P0 | 部署到规则仓库 |
| Version control integration | P0 | Git 版本管理 |
| Real-time performance monitoring | P1 | 实时性能监控 |
| Alert on anomalies | P2 | 异常告警 |

#### 5.1.5 Reporting & BI

| Feature | Priority | Description |
|---------|----------|-------------|
| Daily report generation | P0 | 自动生成日报（放款金额、通过率、DPD 分布等） |
| Business metrics dashboard | P0 | 核心经营指标看板 |
| Vintage analysis | P1 | 账龄分析、逾期趋势 |
| Channel ROI analysis | P1 | 渠道效果对比 |
| Strategy before/after comparison | P1 | 策略上线前后效果对比 |

### 5.2 Data Source Support

Agent 需要支持多种数据源进行分析、特征工程和规则生成。

| Category | Supported | Primary Use Cases |
|----------|-----------|-------------------|
| **Relational DB** | PostgreSQL, MySQL, MariaDB | 历史决策查询、用户行为分析、规则回测 |
| **OLAP** | ClickHouse | 大规模聚合分析、时序特征、实时监控 |
| **Big Data** | Apache Spark (PySpark, Spark SQL) | TB级数据处理、复杂特征工程、分布式回测 |
| **Local Files** | Excel, CSV, TXT | 外部数据导入、测试数据验证 |
| **API** | REST, GraphQL, gRPC (optional) | 外部风控服务、第三方数据源、实时特征 |
| **Cloud Platform** | Snowflake, Databricks | 云数仓查询、跨平台分析 |

**Common Capabilities:**
- Schema introspection & auto-discovery
- Query generation from natural language
- Connection pooling & authentication
- Read-only mode for production environments

### 5.3 Data Quality Management

Agent 能够根据数据规范自动识别问题数据并进行清洗，确保分析和策略基于干净可靠的数据。

| Feature | Priority | Description |
|---------|----------|-------------|
| Schema understanding | P0 | 理解数据表结构、字段类型、业务含义 |
| Anomaly detection | P0 | 自动识别异常值、缺失值、格式错误、逻辑冲突 |
| Data cleaning suggestion | P0 | 针对问题数据提出清洗建议（删除/填充/修正） |
| Cleaning execution | P1 | 执行清洗操作，生成干净数据集 |
| Quality report | P1 | 生成数据质量报告（问题分布、清洗统计） |


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
| Result Acceptance Rate | ≥ 80% | 用户对生成结果的 👍/👎 反馈统计 |
| Task Completion Rate | ≥ 95% | 任务状态跟踪（成功/失败/超时） |
| First-time Success Rate | ≥ 70% | 无需用户修正即可使用的比例 |
| Average Task Duration | < 30s (simple) / < 5min (complex) | 任务计时器 |

**Error Handling:**
- Error Recovery: 遇到错误时优雅降级或提示用户干预
- Timeout Handling: 长时间任务需要进度反馈，避免卡死假象（>10s 显示进度）
- Operation Atomicity: 部署操作要么全部成功要么全部回滚
- Retry Strategy: 可重试错误自动重试（最多 3 次，指数退避）

### 7.2 Security
- Authentication & Authorization (Role-based access control)
- Audit logging (All operations logged)
- Data privacy (Sensitive data anonymization)
- No credential exposure in generated code

### 7.3 Explainability
- **Reasoning Trace**: 展示中间推理步骤和决策依据
- **Data Provenance**: 标注数据来源（哪个表、哪个时间段）
- **Confidence Score**: 对生成结果标注置信度（高/中/低）
- **Alternative Options**: 低置信度时提供备选方案
- **Query Preview**: 执行查询前展示 SQL/代码，允许用户确认

### 7.4 Maintainability
- **Skills Support**: 支持用户自定义 Skills（参考 Claude Skills）
- **Plugin Architecture**: 工具和数据源可插拔扩展
- **Configuration Management**: 支持多环境配置（dev/staging/prod）
- **Logging & Debugging**: 详细的执行日志，支持问题排查

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
以下功能不在 MVP 范围内：
- **Model Training**: 不涉及机器学习模型训练，仅支持规则策略
- **Real-time Streaming**: 不支持实时流处理，仅支持批量查询
- **Multi-tenancy**: 初版不支持多租户隔离
- **Mobile App**: 仅支持 Web UI 和 CLI，不提供移动端
- **Automated Deployment**: 部署需人工审批，不支持全自动上线
- **External Integrations**: 不集成外部 BI 工具（如 Tableau、Metabase）

---

## 9. Agent Runtime Requirements

### 9.1 Context & Memory Management
- **Session Context**: 单次会话内保持完整对话历史
- **Working Memory**: 当前任务相关的中间状态（查询结果、生成的代码等）
- **Long-term Memory**: 跨会话的用户偏好、常用规则模板（可选，P2）

### 9.2 Human-in-the-Loop
| Scenario | Behavior |
|----------|----------|
| 歧义输入 | 主动询问澄清，提供选项 |
| 高风险操作（部署、删除） | 必须用户确认后执行 |
| 低置信度结果 | 标注置信度，建议人工复核 |
| 长时间任务 | 定期同步进度，允许用户中断或修改目标 |

### 9.3 Tool Invocation Transparency
- 显示当前正在调用的工具名称和参数
- 展示工具执行结果摘要
- 支持展开查看完整输入输出（可折叠）

### 9.4 Cost Control
- **Token Budget**: 单次对话 token 上限（默认 100K，可配置）
- **Query Limit**: 单次任务数据库查询次数上限（默认 50 次）
- **Timeout**: 单个工具调用超时（默认 180s），整体任务超时（默认 60min）

---

## 10. Success Metrics

| Metric | Definition | Target (6 months) |
|--------|------------|-------------------|
| Task Success Rate | 任务完成且用户满意的比例 | ≥ 75% |
| Time Saved | 对比人工操作节省的时间 | ≥ 90% |
| Rule Quality Score | 生成规则的精准率/召回率 | 与人工持平 | 

