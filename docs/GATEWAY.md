# CORINT Risk Agent Gateway Architecture Design

## Executive Summary

This document outlines the architecture design for **CORINT Risk Agent Gateway**, a unified control plane that provides multi-client access to AI-powered risk analysis capabilities.

**Key Design Philosophy:**
- **Current State**: CORINT Risk Agent is a CLI tool with rich terminal UI (Ink/React)
- **Future Vision**: Gateway as an **optional extension** that enables multi-client access (Web UI, IM bots, Mobile apps)
- **Inspiration**: OpenClaw's proven gateway pattern - a single WebSocket control plane serving multiple client types
- **Core Principle**: Shared core logic, multiple access methods

## Architecture Overview

### Current Architecture (Phase 1: CLI-First)

```
┌─────────────────────────────────────────────────────────────┐
│              CORINT Risk Agent (CLI)                         │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                   Core Layer                          │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐           │  │
│  │  │  Agent   │  │  Tools   │  │ Services │           │  │
│  │  │ Runtime  │  │  System  │  │  Layer   │           │  │
│  │  └──────────┘  └──────────┘  └──────────┘           │  │
│  │                                                       │  │
│  │  - AI Model Management (Anthropic, OpenAI, etc.)     │  │
│  │  - Context & Session Management                      │  │
│  │  - Cost Tracking & Budget Control                    │  │
│  │  - Data Source Integration (PG, MySQL, ClickHouse)   │  │
│  │  - Plugin System (MCP, Custom Skills)                │  │
│  │  - Risk Analysis Engine                              │  │
│  └──────────────────────────────────────────────────────┘  │
│                           ↕                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                   CLI Layer (Ink/React)               │  │
│  │  - Interactive Terminal UI                            │  │
│  │  - Command Processing                                 │  │
│  │  - User Input/Output                                  │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                           ↕
                    Terminal User
```

### Future Architecture (Phase 2: Gateway Extension)

Inspired by OpenClaw's proven gateway pattern:

```
┌─────────────────────────────────────────────────────────────┐
│              CORINT Risk Agent Gateway                       │
│              (Optional WebSocket Control Plane)              │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Protocol Layer (WebSocket RPC)           │  │
│  │  - Request/Response Handling                          │  │
│  │  - Event Broadcasting                                 │  │
│  │  - Authentication & Authorization                     │  │
│  │  - Device Pairing & Trust Management                  │  │
│  └──────────────────────────────────────────────────────┘  │
│                           ↕                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                   Core Layer (Shared)                 │  │
│  │  - Same core logic as CLI mode                        │  │
│  │  - Agent Runtime, Tools, Services                     │  │
│  │  - Risk Analysis Engine                               │  │
│  │  - Data Source Integration                            │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
         ↕              ↕              ↕              ↕
    CLI Client     Web UI App    IM Bots        Mobile App
   (Terminal)    (Browser UI)  (Slack/Teams)  (iOS/Android)
```

### Core Principles

1. **CLI-First, Gateway-Optional**: CLI remains the primary interface; Gateway is an optional extension for team collaboration
2. **Shared Core Logic**: Both CLI and Gateway modes use the same core components (agent, tools, services)
3. **Protocol-Driven Gateway**: WebSocket RPC for multi-client communication (when Gateway mode is enabled)
4. **Stateful by Design**: Maintain conversation context, user memory, and risk analysis history
5. **Modular & Extensible**: Clear separation of concerns with plugin architecture

## Component Design

### Existing Components (Already Implemented in CLI)

These components are already part of the CORINT Risk Agent CLI and will be reused in Gateway mode:

#### 1. AI Model Management (`src/core/services/ai/`)
**Current Implementation:**
- Multi-provider support (Anthropic, OpenAI, Bedrock, Vertex)
- Model adapter factory pattern
- Response state management
- Streaming support

**Gateway Enhancement:**
- Model pool for concurrent requests
- Load balancing across model instances
- Request queuing and prioritization

#### 2. Context Management (`src/core/services/context/`)
**Current Implementation:**
- Conversation context tracking
- Mention processor for file/code references
- Session state management

**Gateway Enhancement:**
- Multi-session isolation
- Cross-client context synchronization
- Persistent context storage (SQLite/PostgreSQL)

#### 3. Cost Tracking (`src/core/costTracker.ts`)
**Current Implementation:**
- Token usage tracking
- Cost calculation per request

**Gateway Enhancement:**
- Per-user/per-session budgets
- Rate limiting enforcement
- Usage analytics and reporting

#### 4. Data Source Integration (`src/core/services/datasource/`)
**Current Implementation:**
- PostgreSQL, MySQL, ClickHouse, DuckDB, SQLite support
- Schema exploration
- SQL query execution

**Gateway Enhancement:**
- Connection pooling
- Query result caching
- Multi-tenant data isolation

#### 5. Plugin System (`src/core/services/plugins/`)
**Current Implementation:**
- Custom commands/skills
- Plugin validation and runtime
- Skill marketplace integration

**Gateway Enhancement:**
- Plugin lifecycle management
- Hot reload support
- Plugin permission isolation

### New Components (Gateway-Specific)

These components will be added when implementing Gateway mode:

#### 6. Protocol Layer (WebSocket RPC)

**Responsibilities:**
- Define RPC methods and events
- Type-safe request/response validation (Zod schemas)
- Version negotiation
- Authentication and authorization

**Key Methods:**
```typescript
// Analysis Methods
risk.analyze(params: AnalysisRequest): AnalysisResponse
risk.query(params: QueryRequest): QueryResponse
risk.history(params: HistoryRequest): HistoryResponse

// Data Source Methods
datasource.list(): DataSource[]
datasource.explore(params: ExploreRequest): SchemaInfo
datasource.query(params: QueryRequest): QueryResult

// Context Methods
context.save(params: ContextSaveRequest): void
context.load(params: ContextLoadRequest): Context
context.clear(params: ContextClearRequest): void

// Session Methods
session.create(params: SessionCreateRequest): Session
session.list(): Session[]
session.delete(params: SessionDeleteRequest): void

// Admin Methods
admin.health(): HealthStatus
admin.stats(): Statistics
admin.reload(): void
```

**Events:**
```typescript
// Streaming events
analysis.progress(data: ProgressData)
analysis.complete(data: ResultData)
analysis.error(data: ErrorData)

// System events
system.modelLoaded(data: ModelInfo)
system.shutdown(data: ShutdownInfo)
```

#### 7. Session Manager

**Responsibilities:**
- Maintain active sessions per client
- Track conversation history
- Manage user preferences
- Handle session persistence

**Data Structures:**
```typescript
interface Session {
  id: string
  userId: string
  clientType: 'cli' | 'web' | 'mobile' | 'im'
  createdAt: Date
  lastActiveAt: Date
  context: ConversationContext
  metadata: Record<string, unknown>
}

interface ConversationContext {
  messages: Message[]
  workContext: WorkContext
  userMemory: UserMemory
  riskProfile: RiskProfile
}
```

#### 8. Client Connection Manager

**Responsibilities:**
- WebSocket connection lifecycle
- Device pairing and trust management
- Client presence tracking
- Event broadcasting to connected clients

**Features:**
- Device-based authentication (similar to OpenClaw)
- Local connections auto-approved
- Remote connections require pairing approval
- Per-client event subscriptions

#### 9. Risk Engine (Enhanced)

**Responsibilities:**
- Execute risk analysis algorithms
- Apply business rules
- Generate risk scores
- Produce actionable insights

**Components:**
- Rule engine (configurable risk rules)
- Scoring models (quantitative risk assessment)
- Pattern matching (anomaly detection)
- Report generator

#### 10. Knowledge Base (Future)

**Responsibilities:**
- Store risk analysis rules and patterns
- Maintain domain knowledge
- Provide semantic search
- Support incremental updates

**Implementation Options:**
- Vector database (Qdrant, Milvus)
- Hybrid search (keyword + semantic)
- Caching layer for frequent queries

## Technology Stack: Hybrid Architecture

### Strategic Decision: Rust Core + TypeScript UI

Given the requirements for **cloud deployment** and **high concurrency**, we adopt a hybrid architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                    TypeScript Layer                          │
│                                                              │
│  ┌──────────────────┐              ┌──────────────────┐    │
│  │   CLI Client     │              │    Web UI        │    │
│  │   (Ink/React)    │              │    (React)       │    │
│  └──────────────────┘              └──────────────────┘    │
│           ↓                                  ↓               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         Gateway Client SDK (TypeScript)              │  │
│  │         - WebSocket client                           │  │
│  │         - Type-safe RPC calls                        │  │
│  │         - Event handling                             │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                           ↕ WebSocket (JSON-RPC)
┌─────────────────────────────────────────────────────────────┐
│                      Rust Layer                              │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Gateway Server (Rust)                    │  │
│  │  - WebSocket server (tokio-tungstenite)              │  │
│  │  - Protocol handling (serde_json)                    │  │
│  │  - Session management                                │  │
│  │  - Authentication & authorization                    │  │
│  │  - Event broadcasting                                │  │
│  └──────────────────────────────────────────────────────┘  │
│                           ↕                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                Core Engine (Rust)                     │  │
│  │  - Agent runtime                                      │  │
│  │  - Tool execution                                     │  │
│  │  - AI model integration                               │  │
│  │  - Risk analysis engine                               │  │
│  │  - Data source connectors                            │  │
│  │  - Context management                                │  │
│  │  - Cost tracking                                     │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Rust Layer (Core + Gateway)

**Why Rust for Cloud Deployment:**

1. **Performance & Efficiency**
   - 🚀 **10-100x faster** than Node.js for CPU-intensive tasks
   - 💾 **50-70% less memory** usage (critical for cloud cost optimization)
   - ⚡ **Sub-millisecond latency** for most operations
   - 🔄 **Handles 10,000+ concurrent connections** per instance

2. **Cost Optimization**
   - Cloud resources billed by CPU/memory usage
   - Rust's efficiency = **significant cost savings** at scale
   - Example: 1 Rust instance can replace 3-5 Node.js instances

3. **Predictable Performance**
   - ✅ No GC pauses (critical for real-time risk analysis)
   - ✅ Consistent P99 latency
   - ✅ Better resource utilization under load

4. **Safety & Reliability**
   - ✅ Memory safety without GC
   - ✅ Thread safety guaranteed by compiler
   - ✅ Fewer runtime errors in production

**Rust Stack:**
```toml
[dependencies]
# Async runtime
tokio = { version = "1.40", features = ["full"] }

# WebSocket server
tokio-tungstenite = "0.24"
axum = "0.7"  # HTTP server for REST API

# Serialization
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"

# Database
sqlx = { version = "0.8", features = ["postgres", "mysql", "sqlite", "runtime-tokio"] }
clickhouse = "0.12"

# AI SDKs (via HTTP clients)
reqwest = { version = "0.12", features = ["json", "stream"] }

# Validation
validator = "0.18"

# Logging
tracing = "0.1"
tracing-subscriber = "0.3"

# Error handling
anyhow = "1.0"
thiserror = "1.0"
```

### TypeScript Layer (CLI + Web UI)

**Why TypeScript for UI:**

1. **Development Velocity**
   - ✅ Rapid UI iteration
   - ✅ Rich ecosystem (React, Ink, etc.)
   - ✅ Hot reload for fast feedback

2. **Team Expertise**
   - ✅ Frontend developers familiar with TypeScript
   - ✅ Lower learning curve for UI development

3. **Ecosystem Maturity**
   - ✅ Excellent UI libraries
   - ✅ Testing tools (Jest, Vitest)
   - ✅ Build tools (Vite, esbuild)

**TypeScript Stack:**
```json
{
  "dependencies": {
    // CLI
    "ink": "5.2.1",
    "@inkjs/ui": "^2.0.0",
    "commander": "^13.1.0",

    // Web UI
    "react": "18.3.1",
    "react-dom": "18.3.1",

    // Gateway client
    "ws": "^8.18.0",

    // Validation (shared with Rust via JSON Schema)
    "zod": "^3.25.76",

    // Build
    "vite": "^6.0.0",
    "typescript": "^5.9.2"
  }
}
```

### Communication Protocol

**TypeScript ↔ Rust via WebSocket JSON-RPC:**

```typescript
// TypeScript client
interface RpcRequest {
  id: string
  method: string
  params: unknown
}

interface RpcResponse {
  id: string
  result?: unknown
  error?: { code: number; message: string }
}

// Rust server
#[derive(Serialize, Deserialize)]
struct RpcRequest {
    id: String,
    method: String,
    params: serde_json::Value,
}

#[derive(Serialize, Deserialize)]
struct RpcResponse {
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<RpcError>,
}
```

### Migration Strategy

**Phase 1: Current (TypeScript Prototype)**
- ✅ Rapid prototyping with TypeScript
- ✅ Validate architecture and features
- ✅ Build UI components

**Phase 2: Rust Core (Month 3-6)**
- 🔄 Rewrite core engine in Rust
- 🔄 Implement data source connectors
- 🔄 Build risk analysis engine
- ✅ Keep TypeScript CLI/UI unchanged

**Phase 3: Rust Gateway (Month 6-9)**
- 🔄 Implement WebSocket gateway in Rust
- 🔄 Session management
- 🔄 Authentication & authorization
- ✅ TypeScript clients connect via WebSocket

**Phase 4: Cloud Deployment (Month 9-12)**
- 🔄 Kubernetes deployment
- 🔄 Horizontal scaling
- 🔄 Load balancing
- 🔄 Monitoring & observability

### Performance Comparison

| Metric | TypeScript (Bun) | Rust |
|--------|------------------|------|
| Memory (idle) | ~50MB | ~5MB |
| Memory (1000 sessions) | ~500MB | ~100MB |
| Latency (P50) | 10-50ms | 1-5ms |
| Latency (P99) | 100-500ms | 10-50ms |
| Concurrent connections | 1,000-5,000 | 10,000-50,000 |
| CPU usage (same load) | 100% | 20-30% |

### Cost Analysis (Cloud Deployment)

**Scenario: 10,000 concurrent users**

**TypeScript (Bun):**
- Instances: 5x (8 vCPU, 16GB RAM)
- Cost: ~$1,500/month (AWS c7g.2xlarge)

**Rust:**
- Instances: 2x (4 vCPU, 8GB RAM)
- Cost: ~$400/month (AWS c7g.xlarge)

**Savings: ~$1,100/month (~73% reduction)**

### Recommendation

✅ **Adopt Hybrid Architecture:**
1. **Rust for Core + Gateway** (performance, cost, scalability)
2. **TypeScript for CLI + Web UI** (development speed, ecosystem)
3. **JSON-RPC over WebSocket** (clean separation, language-agnostic)

This approach gives you:
- 🚀 Best performance for cloud deployment
- 💰 Significant cost savings at scale
- ⚡ Fast UI development iteration
- 🔧 Clear separation of concerns
- 📈 Easy horizontal scaling

## Implementation Roadmap

### Phase 1: TypeScript Prototype (Current - Month 3)

**Focus**: Rapid prototyping and feature validation

**Deliverables:**
- ✅ Full-featured CLI with TypeScript
- ✅ Core risk analysis capabilities
- ✅ Data source integration
- ✅ Plugin system
- ✅ Architecture validation

**Success Criteria:**
- CLI provides comprehensive risk analysis
- Core components are well-designed
- Clear understanding of performance requirements

### Phase 2: Rust Core Engine (Month 3-6)

**Milestone 2.1: Core Infrastructure (Weeks 1-4)**

**Deliverables:**
- Rust project setup (Cargo workspace)
- Core data structures (Agent, Tool, Context)
- Database connectors (PostgreSQL, MySQL, ClickHouse)
- AI model integration (Anthropic, OpenAI via HTTP)
- Error handling and logging (tracing)

**Success Criteria:**
- Rust core can execute basic risk analysis
- Database queries work correctly
- AI model calls successful

**Milestone 2.2: Feature Parity (Weeks 5-8)**

**Deliverables:**
- Tool system implementation
- Context management
- Cost tracking
- Plugin system (WASM or dynamic loading)
- Risk analysis engine

**Success Criteria:**
- Rust core has feature parity with TypeScript prototype
- Performance benchmarks show 5-10x improvement
- Memory usage reduced by 50%+

**Milestone 2.3: TypeScript Bridge (Weeks 9-12)**

**Deliverables:**
- FFI bridge using `napi-rs`
- TypeScript bindings generation
- CLI integration with Rust core
- Comprehensive testing

**Success Criteria:**
- CLI can use Rust core seamlessly
- No breaking changes to CLI UX
- All tests passing

### Phase 3: Rust Gateway Server (Month 6-9)

**Milestone 3.1: WebSocket Gateway (Weeks 13-16)**

**Deliverables:**
- WebSocket server (tokio-tungstenite)
- JSON-RPC protocol implementation
- Session management
- Device pairing and authentication
- Event broadcasting

**Success Criteria:**
- Multiple clients can connect
- Real-time event streaming works
- Session isolation enforced

**Milestone 3.2: Multi-Client Support (Weeks 17-20)**

**Deliverables:**
- TypeScript Gateway client SDK
- CLI gateway mode
- Web UI (React + Vite)
- IM bot framework (Slack, Teams)

**Success Criteria:**
- CLI works in both direct and gateway modes
- Web UI provides core functionality
- IM bots can handle basic queries

**Milestone 3.3: Production Features (Weeks 21-24)**

**Deliverables:**
- Health checks and monitoring
- Graceful shutdown
- Configuration hot reload
- Rate limiting and quotas
- Comprehensive logging

**Success Criteria:**
- Gateway handles 1,000+ concurrent connections
- Sub-100ms P99 latency
- Zero-downtime restarts

### Phase 4: Cloud Deployment (Month 9-12)

**Milestone 4.1: Containerization (Weeks 25-28)**

**Deliverables:**
- Multi-stage Docker builds
- Kubernetes manifests
- Helm charts
- CI/CD pipelines (GitHub Actions)

**Success Criteria:**
- Docker images < 50MB (Rust binary)
- Kubernetes deployment successful
- Automated builds and tests

**Milestone 4.2: Scalability (Weeks 29-32)**

**Deliverables:**
- Horizontal pod autoscaling
- Load balancing (Nginx/Envoy)
- Distributed session storage (Redis)
- Database connection pooling

**Success Criteria:**
- Auto-scales from 2 to 20 pods
- Handles 10,000+ concurrent users
- Database connections managed efficiently

**Milestone 4.3: Observability (Weeks 33-36)**

**Deliverables:**
- Prometheus metrics
- Grafana dashboards
- Distributed tracing (Jaeger/Tempo)
- Log aggregation (Loki/ELK)
- Alerting (PagerDuty/Slack)

**Success Criteria:**
- Full visibility into system health
- Alerts for critical issues
- Performance bottlenecks identified

**Milestone 4.4: Production Hardening (Weeks 37-40)**

**Deliverables:**
- Security audit
- Load testing (10,000+ concurrent users)
- Disaster recovery plan
- Documentation and runbooks
- Performance optimization

**Success Criteria:**
- 99.9% uptime SLA
- Security vulnerabilities addressed
- Load tests pass
- Team trained on operations

## File Structure

### Phase 1: TypeScript Prototype (Current)

```
corint-agent/
├── src/
│   ├── core/                      # Core logic (TypeScript prototype)
│   ├── cli/                       # CLI interface
│   └── entrypoints/
└── ... (current structure)
```

### Phase 2-4: Hybrid Architecture (Rust + TypeScript)

```
corint-agent/
├── crates/                        # Rust workspace (NEW)
│   ├── corint-core/               # Core engine
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── agent/             # Agent runtime
│   │   │   │   ├── mod.rs
│   │   │   │   ├── executor.rs
│   │   │   │   └── planner.rs
│   │   │   ├── tools/             # Tool system
│   │   │   │   ├── mod.rs
│   │   │   │   ├── filesystem.rs
│   │   │   │   ├── database.rs
│   │   │   │   └── network.rs
│   │   │   ├── ai/                # AI model integration
│   │   │   │   ├── mod.rs
│   │   │   │   ├── anthropic.rs
│   │   │   │   └── openai.rs
│   │   │   ├── datasource/        # Data source connectors
│   │   │   │   ├── mod.rs
│   │   │   │   ├── postgres.rs
│   │   │   │   ├── mysql.rs
│   │   │   │   └── clickhouse.rs
│   │   │   ├── context/           # Context management
│   │   │   │   ├── mod.rs
│   │   │   │   ├── manager.rs
│   │   │   │   └── storage.rs
│   │   │   ├── risk/              # Risk analysis engine
│   │   │   │   ├── mod.rs
│   │   │   │   ├── engine.rs
│   │   │   │   ├── rules.rs
│   │   │   │   └── scoring.rs
│   │   │   └── cost/              # Cost tracking
│   │   │       ├── mod.rs
│   │   │       └── tracker.rs
│   │   ├── Cargo.toml
│   │   └── README.md
│   │
│   ├── corint-gateway/            # Gateway server
│   │   ├── src/
│   │   │   ├── main.rs            # Gateway entry point
│   │   │   ├── lib.rs
│   │   │   ├── server/            # WebSocket server
│   │   │   │   ├── mod.rs
│   │   │   │   ├── websocket.rs
│   │   │   │   └── http.rs
│   │   │   ├── protocol/          # JSON-RPC protocol
│   │   │   │   ├── mod.rs
│   │   │   │   ├── request.rs
│   │   │   │   ├── response.rs
│   │   │   │   └── events.rs
│   │   │   ├── handlers/          # RPC handlers
│   │   │   │   ├── mod.rs
│   │   │   │   ├── risk.rs
│   │   │   │   ├── datasource.rs
│   │   │   │   ├── context.rs
│   │   │   │   └── admin.rs
│   │   │   ├── session/           # Session management
│   │   │   │   ├── mod.rs
│   │   │   │   ├── manager.rs
│   │   │   │   └── storage.rs
│   │   │   ├── auth/              # Authentication
│   │   │   │   ├── mod.rs
│   │   │   │   ├── token.rs
│   │   │   │   └── pairing.rs
│   │   │   └── runtime/           # Runtime state
│   │   │       ├── mod.rs
│   │   │       ├── state.rs
│   │   │       └── broadcast.rs
│   │   ├── Cargo.toml
│   │   └── README.md
│   │
│   ├── corint-ffi/                # FFI bridge (napi-rs)
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── agent.rs           # Agent FFI bindings
│   │   │   ├── datasource.rs      # DataSource FFI bindings
│   │   │   └── risk.rs            # Risk analysis FFI bindings
│   │   ├── Cargo.toml
│   │   ├── package.json
│   │   └── README.md
│   │
│   └── Cargo.toml                 # Workspace manifest
│
├── src/                           # TypeScript layer
│   ├── cli/                       # CLI interface
│   │   ├── components/            # Ink UI components
│   │   ├── commands/              # CLI commands
│   │   ├── screens/               # UI screens
│   │   └── hooks/                 # React hooks
│   │
│   ├── web/                       # Web UI (NEW)
│   │   ├── src/
│   │   │   ├── App.tsx
│   │   │   ├── components/        # React components
│   │   │   │   ├── Chat/
│   │   │   │   ├── DataSource/
│   │   │   │   ├── Session/
│   │   │   │   └── Dashboard/
│   │   │   ├── hooks/             # React hooks
│   │   │   │   ├── useGateway.ts
│   │   │   │   └── useSession.ts
│   │   │   └── services/
│   │   │       └── gateway-client.ts
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   └── package.json
│   │
│   ├── gateway-client/            # Gateway client SDK (NEW)
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── client.ts          # WebSocket client
│   │   │   ├── protocol.ts        # Protocol types
│   │   │   └── events.ts          # Event handling
│   │   ├── package.json
│   │   └── README.md
│   │
│   ├── im/                        # IM bot integrations (NEW)
│   │   ├── slack/
│   │   │   ├── bot.ts
│   │   │   └── handlers.ts
│   │   ├── teams/
│   │   │   ├── bot.ts
│   │   │   └── handlers.ts
│   │   └── common/
│   │       └── gateway-adapter.ts
│   │
│   ├── entrypoints/
│   │   ├── cli.tsx                # CLI entry point
│   │   └── web.tsx                # Web UI entry point (NEW)
│   │
│   └── shared/                    # Shared TypeScript code
│       ├── types/                 # Shared types
│       └── utils/                 # Shared utilities
│
├── tests/
│   ├── rust/                      # Rust tests (NEW)
│   │   ├── integration/
│   │   └── e2e/
│   ├── typescript/                # TypeScript tests
│   │   ├── unit/
│   │   └── integration/
│   └── gateway/                   # Gateway tests (NEW)
│       ├── protocol.test.ts
│       ├── session.test.ts
│       └── multi-client.test.ts
│
├── docs/
│   ├── GATEWAY.md                 # This document
│   ├── rust/                      # Rust documentation (NEW)
│   │   ├── architecture.md
│   │   ├── ffi-bridge.md
│   │   └── performance.md
│   └── gateway/                   # Gateway documentation (NEW)
│       ├── protocol.md
│       ├── authentication.md
│       └── deployment.md
│
├── k8s/                           # Kubernetes manifests (NEW)
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── ingress.yaml
│   └── configmap.yaml
│
├── docker/                        # Docker files (NEW)
│   ├── Dockerfile.gateway         # Gateway image
│   ├── Dockerfile.web             # Web UI image
│   └── docker-compose.yml
│
├── scripts/
│   ├── build-rust.sh              # Build Rust crates (NEW)
│   ├── build-ffi.sh               # Build FFI bridge (NEW)
│   └── deploy.sh                  # Deployment script (NEW)
│
├── Cargo.toml                     # Rust workspace root (NEW)
├── package.json                   # TypeScript workspace root
├── tsconfig.json
└── README.md
```

### Key Directories Explained

**Rust Layer (`crates/`):**
- `corint-core/`: Core engine (agent, tools, AI, datasource, risk)
- `corint-gateway/`: WebSocket gateway server
- `corint-ffi/`: FFI bridge for TypeScript integration

**TypeScript Layer (`src/`):**
- `cli/`: Terminal UI (Ink/React)
- `web/`: Web UI (React/Vite)
- `gateway-client/`: Gateway client SDK (shared by CLI/Web/IM)
- `im/`: IM bot integrations (Slack, Teams)

**Infrastructure:**
- `k8s/`: Kubernetes deployment manifests
- `docker/`: Docker images and compose files
- `tests/`: Comprehensive test suites

## Configuration Example

### CLI Mode Configuration (Current)

```json
{
  "ai": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-5",
    "timeout": 60000
  },
  "datasource": {
    "risk_db": {
      "type": "postgres",
      "host": "${DB_HOST}",
      "port": 5432,
      "database": "risk_data",
      "user": "${DB_USER}",
      "password": "${DB_PASSWORD}"
    },
    "analytics": {
      "type": "clickhouse",
      "url": "${CLICKHOUSE_URL}"
    }
  },
  "cost": {
    "defaultBudget": 1000000,
    "trackUsage": true
  }
}
```

### Gateway Mode Configuration (Future)

```json
{
  "mode": "gateway",
  "gateway": {
    "host": "127.0.0.1",
    "port": 18789,
    "bind": "loopback",
    "auth": {
      "mode": "token",
      "token": "${CORINT_GATEWAY_TOKEN}",
      "devicePairing": {
        "enabled": true,
        "autoApproveLocal": true
      }
    },
    "tls": {
      "enabled": false,
      "cert": "/path/to/cert.pem",
      "key": "/path/to/key.pem"
    },
    "controlUi": {
      "enabled": true,
      "basePath": "/"
    }
  },
  "ai": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-5",
    "poolSize": 3,
    "timeout": 60000
  },
  "context": {
    "maxHistoryLength": 100,
    "persistenceInterval": 5000,
    "storage": {
      "type": "sqlite",
      "path": "./data/context.db"
    }
  },
  "cost": {
    "defaultBudget": 1000000,
    "rateLimit": {
      "requestsPerMinute": 60,
      "tokensPerDay": 1000000
    }
  },
  "datasource": {
    "risk_db": {
      "type": "postgres",
      "host": "${DB_HOST}",
      "port": 5432,
      "database": "risk_data",
      "user": "${DB_USER}",
      "password": "${DB_PASSWORD}",
      "pool": {
        "min": 2,
        "max": 10
      }
    }
  },
  "knowledge": {
    "vectorDb": {
      "type": "qdrant",
      "url": "http://localhost:6333"
    },
    "embeddingModel": "text-embedding-3-small"
  },
  "channels": {
    "slack": {
      "enabled": false,
      "botToken": "${SLACK_BOT_TOKEN}",
      "appToken": "${SLACK_APP_TOKEN}"
    },
    "teams": {
      "enabled": false,
      "appId": "${TEAMS_APP_ID}",
      "appPassword": "${TEAMS_APP_PASSWORD}"
    }
  }
}
```

## Security Considerations

### Authentication

- Device-based authentication (RSA key pairs)
- Token-based authentication (JWT)
- Password authentication (for web UI)
- Multi-factor authentication support

### Authorization

- Role-based access control (RBAC)
- Scope-based permissions
- Per-method authorization checks
- Audit logging

### Network Security

- TLS/SSL for all connections
- Certificate pinning for mobile clients
- IP allowlisting (optional)
- Rate limiting and DDoS protection

### Data Security

- Encryption at rest for sensitive data
- Secure credential storage
- PII handling and anonymization
- GDPR compliance considerations

## Monitoring and Observability

### Metrics

- Request latency (p50, p95, p99)
- Token usage per user/session
- Model inference time
- Active connections
- Error rates
- Memory and CPU usage

### Logging

- Structured logging (JSON format)
- Log levels: DEBUG, INFO, WARN, ERROR
- Request/response logging
- Audit trail for sensitive operations

### Alerting

- High error rate
- Latency degradation
- Resource exhaustion
- Authentication failures
- Budget exceeded

## Deployment

### Local Development

#### TypeScript Prototype (Phase 1)
```bash
# Install dependencies
bun install

# Run CLI
bun run dev

# Run tests
bun test
```

#### Rust Development (Phase 2+)
```bash
# Build Rust core
cd crates/corint-core
cargo build --release

# Build FFI bridge
cd crates/corint-ffi
npm run build

# Run Rust tests
cargo test

# Run TypeScript CLI with Rust core
cd ../..
bun run dev
```

#### Gateway Development (Phase 3+)
```bash
# Start Rust gateway server
cd crates/corint-gateway
cargo run --release

# Start Web UI dev server
cd src/web
npm run dev

# Start CLI in gateway mode
corint --gateway ws://127.0.0.1:18789
```

### Production Deployment

#### Docker (Single Instance)

**Gateway Dockerfile:**
```dockerfile
# Multi-stage build for Rust gateway
FROM rust:1.83-alpine AS builder
WORKDIR /app

# Install dependencies
RUN apk add --no-cache musl-dev openssl-dev

# Copy Cargo files
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates

# Build release binary
RUN cargo build --release --package corint-gateway

# Runtime stage
FROM alpine:3.20
RUN apk add --no-cache ca-certificates libgcc

# Copy binary
COPY --from=builder /app/target/release/corint-gateway /usr/local/bin/

# Expose port
EXPOSE 18789

# Run gateway
CMD ["corint-gateway"]
```

**Web UI Dockerfile:**
```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app

# Copy package files
COPY src/web/package*.json ./
RUN npm ci

# Copy source
COPY src/web ./
RUN npm run build

# Runtime stage
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
```

**Docker Compose:**
```yaml
version: '3.8'

services:
  gateway:
    build:
      context: .
      dockerfile: docker/Dockerfile.gateway
    ports:
      - "18789:18789"
    environment:
      - RUST_LOG=info
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - DATABASE_URL=${DATABASE_URL}
    volumes:
      - gateway-data:/data
    restart: unless-stopped

  web:
    build:
      context: .
      dockerfile: docker/Dockerfile.web
    ports:
      - "80:80"
    depends_on:
      - gateway
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    environment:
      - POSTGRES_DB=corint
      - POSTGRES_USER=corint
      - POSTGRES_PASSWORD=${DB_PASSWORD}
    volumes:
      - postgres-data:/var/lib/postgresql/data
    restart: unless-stopped

volumes:
  gateway-data:
  postgres-data:
```

```bash
# Build and run
docker-compose up -d

# View logs
docker-compose logs -f gateway

# Scale gateway
docker-compose up -d --scale gateway=3
```

#### Kubernetes (Cloud Deployment)

**Deployment:**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: corint-gateway
  namespace: corint
spec:
  replicas: 3
  selector:
    matchLabels:
      app: corint-gateway
  template:
    metadata:
      labels:
        app: corint-gateway
    spec:
      containers:
      - name: gateway
        image: corint/gateway:latest
        ports:
        - containerPort: 18789
          name: websocket
        env:
        - name: RUST_LOG
          value: "info"
        - name: ANTHROPIC_API_KEY
          valueFrom:
            secretKeyRef:
              name: corint-secrets
              key: anthropic-api-key
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: corint-secrets
              key: database-url
        resources:
          requests:
            memory: "256Mi"
            cpu: "500m"
          limits:
            memory: "512Mi"
            cpu: "1000m"
        livenessProbe:
          httpGet:
            path: /health
            port: 18789
          initialDelaySeconds: 10
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /ready
            port: 18789
          initialDelaySeconds: 5
          periodSeconds: 10
```

**Service:**
```yaml
apiVersion: v1
kind: Service
metadata:
  name: corint-gateway
  namespace: corint
spec:
  selector:
    app: corint-gateway
  ports:
  - port: 18789
    targetPort: 18789
    name: websocket
  type: ClusterIP
```

**Ingress:**
```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: corint-ingress
  namespace: corint
  annotations:
    nginx.ingress.kubernetes.io/websocket-services: "corint-gateway"
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
spec:
  ingressClassName: nginx
  tls:
  - hosts:
    - corint.example.com
    secretName: corint-tls
  rules:
  - host: corint.example.com
    http:
      paths:
      - path: /ws
        pathType: Prefix
        backend:
          service:
            name: corint-gateway
            port:
              number: 18789
      - path: /
        pathType: Prefix
        backend:
          service:
            name: corint-web
            port:
              number: 80
```

**HorizontalPodAutoscaler:**
```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: corint-gateway-hpa
  namespace: corint
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: corint-gateway
  minReplicas: 2
  maxReplicas: 20
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

```bash
# Deploy to Kubernetes
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/secrets.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/ingress.yaml
kubectl apply -f k8s/hpa.yaml

# Check status
kubectl get pods -n corint
kubectl logs -f deployment/corint-gateway -n corint

# Scale manually
kubectl scale deployment corint-gateway --replicas=5 -n corint
```

#### Systemd (Single Server)

**Gateway Service:**
```ini
[Unit]
Description=CORINT Risk Agent Gateway
After=network.target postgresql.service

[Service]
Type=simple
User=corint
Group=corint
WorkingDirectory=/opt/corint-agent
ExecStart=/opt/corint-agent/bin/corint-gateway
Restart=always
RestartSec=10
Environment="RUST_LOG=info"
EnvironmentFile=/opt/corint-agent/.env

# Security
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/corint-agent/data

[Install]
WantedBy=multi-user.target
```

```bash
# Install
sudo cp corint-gateway.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable corint-gateway
sudo systemctl start corint-gateway

# Check status
sudo systemctl status corint-gateway
sudo journalctl -u corint-gateway -f
```

## Testing Strategy

### Unit Tests

- Protocol validation
- Handler logic
- Context management
- Cost calculation

### Integration Tests

- Client-server communication
- AI model integration
- Database operations
- External API calls

### End-to-End Tests

- Full user workflows
- Multi-client scenarios
- Error recovery
- Performance benchmarks

### Load Testing

- Concurrent connections (100+)
- Sustained request rate
- Memory leak detection
- Graceful degradation

## Future Enhancements

### Phase 2 Features

- Real-time collaboration (multiple users on same analysis)
- Streaming responses (progressive results)
- Plugin marketplace
- Advanced analytics dashboard

### Phase 3 Features

- Distributed gateway (multi-node cluster)
- Edge deployment (on-premise gateways)
- Federated learning (privacy-preserving)
- Custom model fine-tuning

## Conclusion

The CORINT Risk Agent adopts a **hybrid Rust + TypeScript architecture** to achieve the best balance of performance, cost-efficiency, and development velocity.

**Architecture Summary:**

```
┌─────────────────────────────────────────────────────────────┐
│  TypeScript Layer (UI)                                       │
│  - CLI (Ink/React)                                           │
│  - Web UI (React/Vite)                                       │
│  - IM Bots (Slack/Teams)                                     │
└─────────────────────────────────────────────────────────────┘
                           ↕ WebSocket JSON-RPC
┌─────────────────────────────────────────────────────────────┐
│  Rust Layer (Core + Gateway)                                 │
│  - Gateway Server (tokio-tungstenite)                        │
│  - Core Engine (agent, tools, AI, risk)                     │
│  - Data Source Connectors (PostgreSQL, MySQL, ClickHouse)   │
└─────────────────────────────────────────────────────────────┘
```

**Key Decisions:**

1. ✅ **Rust for Core + Gateway**
   - 10-100x performance improvement
   - 50-70% memory reduction
   - 73% cloud cost savings
   - Predictable latency (no GC pauses)

2. ✅ **TypeScript for UI**
   - Fast UI iteration
   - Rich ecosystem (React, Ink)
   - Team expertise

3. ✅ **WebSocket JSON-RPC Protocol**
   - Language-agnostic
   - Real-time bidirectional communication
   - Clean separation of concerns

4. ✅ **Incremental Migration**
   - Phase 1: TypeScript prototype (validate features)
   - Phase 2: Rust core (performance)
   - Phase 3: Rust gateway (scalability)
   - Phase 4: Cloud deployment (production)

**Benefits:**

- 🚀 **Performance**: Sub-millisecond latency for risk analysis
- 💰 **Cost**: 73% reduction in cloud infrastructure costs
- 📈 **Scalability**: 10,000+ concurrent users per instance
- ⚡ **Development Speed**: Fast UI iteration with TypeScript
- 🔧 **Maintainability**: Clear separation between UI and core logic
- 🛡️ **Safety**: Rust's memory safety guarantees

**Trade-offs:**

- ⚠️ **Complexity**: Two languages to maintain
- ⚠️ **Learning Curve**: Team needs Rust expertise
- ⚠️ **Initial Investment**: Longer Phase 2 development time

**Mitigation:**

- Start with TypeScript prototype to validate architecture
- Hire/train Rust developers during Phase 1
- Use FFI bridge (`napi-rs`) for gradual migration
- Comprehensive documentation and knowledge sharing

**Next Steps:**

1. **Phase 1 (Month 0-3)**: Complete TypeScript prototype
   - Validate all features
   - Finalize architecture
   - Build team Rust expertise

2. **Phase 2 (Month 3-6)**: Implement Rust core
   - Core engine
   - Data source connectors
   - FFI bridge
   - Performance benchmarks

3. **Phase 3 (Month 6-9)**: Implement Rust gateway
   - WebSocket server
   - Multi-client support
   - Web UI and IM bots

4. **Phase 4 (Month 9-12)**: Cloud deployment
   - Kubernetes setup
   - Horizontal scaling
   - Monitoring and observability
   - Production hardening

**Success Metrics:**

- ✅ P99 latency < 50ms
- ✅ Memory usage < 100MB per 1,000 sessions
- ✅ Support 10,000+ concurrent users
- ✅ 99.9% uptime SLA
- ✅ 70%+ cloud cost reduction vs TypeScript-only

**References:**

- [Rust Async Book](https://rust-lang.github.io/async-book/)
- [Tokio Documentation](https://tokio.rs/)
- [napi-rs](https://napi.rs/) - Node.js FFI for Rust
- [OpenClaw Gateway](https://github.com/openclaw/openclaw) - Proven WebSocket gateway pattern
- [Axum Web Framework](https://github.com/tokio-rs/axum)

---

*Document Version: 3.0*
*Last Updated: 2026-02-06*
*Author: Claude Sonnet 4.5*
*Architecture: Hybrid Rust + TypeScript*
*Deployment Target: Cloud + On-Premise*
