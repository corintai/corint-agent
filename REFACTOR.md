# CORINT Agent Architecture Refactoring Plan

## Executive Summary

This document outlines a refactoring plan to reorganize the CORINT Agent codebase to better support multi-interface development (CLI + Web UI + Mobile). The current structure mixes CLI-specific code with core business logic, making it difficult to add new interfaces like Web UI or mobile apps.

**Goal**: Clear separation between core business logic and interface-specific implementations, enabling easy development of Web UI (like Manus) and mobile applications.

**Timeline**: 2-3 weeks for full migration (including testing and validation)

**Status**: Updated based on actual codebase analysis (2026-01-17)

---

## Current Problems

### Directory Structure Issues (Based on Actual Codebase Analysis)

```
src/
├── ui/                    # ❌ Misleading - actually CLI-specific (Ink components)
│   ├── screens/           # REPL.tsx, Doctor.tsx, LogList.tsx (terminal-only)
│   ├── components/        # 50+ Ink components (terminal-specific)
│   └── hooks/             # Mix of generic and CLI-specific hooks
├── entrypoints/
│   ├── cli/               # CLI setup logic (bootstrapEnv, printMode, runCli)
│   └── cli.tsx            # Main CLI entry point
├── app/                   # ❌ Unclear - contains query.ts (core) + binaryFeedback.ts (CLI)
├── agent/                 # ✅ Core orchestration logic (good)
├── services/              # ⚠️ Mixed - contains both core and UI-specific services
│   ├── ai/                # ✅ Core LLM services
│   ├── datasource/        # ✅ Core data access
│   ├── mcp/               # ✅ Core MCP integration
│   ├── system/            # ✅ Core system utilities
│   └── ui/                # ❌ CLI-specific (notifier, statusline, outputStyles)
├── tools/                 # ⚠️ Mix of core logic + CLI rendering (TSX files)
├── commands/              # ❌ CLI-specific slash commands
├── core/                  # ⚠️ Partially organized (config, permissions, tools)
├── constants/             # ⚠️ Mix of core and CLI-specific constants
└── utils/                 # ⚠️ Mix of core and CLI-specific utilities
```

**Critical Issues**:
1. **Misleading naming**: `src/ui/` appears generic but is 100% CLI-specific (Ink components)
2. **Mixed responsibilities**: `src/app/` contains both core logic (query.ts) and CLI code (binaryFeedback.ts)
3. **Tool rendering coupling**: Many tools have `.tsx` files with Ink-specific rendering logic
4. **Service layer confusion**: `services/ui/` is CLI-specific but sits alongside core services
5. **Scattered core logic**: Core functionality spread across `agent/`, `app/`, `core/`, and `services/`
6. **No clear interface boundary**: Hard to identify what's reusable vs. CLI-specific
7. **Dependency mixing**: Ink, yoga-wasm, and terminal utilities mixed with core dependencies

---

## Proposed Architecture

### Recommended Structure: Clean Separation by Layer

```
src/
├── core/                      # Core business logic (UI-agnostic) ✨
│   ├── agent/                 # Agent orchestration (MOVE from src/agent/)
│   │   ├── orchestrator.ts    # Main query() function
│   │   ├── executor.ts        # Tool execution engine
│   │   ├── planner.ts         # Planning logic
│   │   └── types.ts           # Core agent types
│   ├── tools/                 # Tool implementations (REFACTOR from src/tools/)
│   │   ├── system/            # BashTool, KillShellTool, TaskOutputTool
│   │   ├── filesystem/        # FileReadTool, FileEditTool, FileWriteTool, GlobTool
│   │   ├── data/              # QuerySQLTool, ExploreSchemaTool, ListDataSourcesTool
│   │   ├── network/           # WebFetchTool, WebSearchTool
│   │   ├── search/            # GrepTool, LspTool
│   │   ├── interaction/       # AskUserQuestionTool, TodoWriteTool
│   │   ├── agent/             # TaskTool, PlanModeTool (sub-agents)
│   │   ├── ai/                # SkillTool, AskExpertModelTool
│   │   ├── mcp/               # MCPTool, ListMcpResourcesTool, ReadMcpResourceTool
│   │   ├── registry.ts        # Tool registration
│   │   ├── executor.ts        # Tool execution logic
│   │   └── tool.ts            # Base tool interface
│   ├── services/              # External service integrations (MOVE from src/services/)
│   │   ├── ai/                # LLM providers (OpenAI, Anthropic, DeepSeek, Bedrock)
│   │   │   ├── adapters/      # Model adapters
│   │   │   ├── llm.ts         # Main LLM interface
│   │   │   ├── llmLazy.ts     # Lazy loading
│   │   │   └── modelAdapterFactory.ts
│   │   ├── datasource/        # Database connections (MySQL, PostgreSQL, ClickHouse, SQLite)
│   │   ├── mcp/               # MCP client (connects to external MCP servers)
│   │   │   ├── client.ts      # MCP client implementation
│   │   │   ├── discovery.ts   # Discover external MCP servers
│   │   │   └── tools-integration.ts # Integrate external MCP tools
│   │   ├── context/           # Context management (kodeContext, mentionProcessor)
│   │   ├── system/            # System utilities (fileFreshness, vcr, systemPrompt)
│   │   ├── plugins/           # Plugin system (customCommands, skillMarketplace)
│   │   └── telemetry/         # Logging and metrics (Sentry)
│   ├── config/                # Configuration management (MOVE from src/core/config/)
│   │   ├── schema.ts          # Config schema
│   │   ├── loader.ts          # Config loading
│   │   ├── validator.ts       # Config validation
│   │   └── migrations.ts      # Config migrations
│   ├── permissions/           # Permission engine (MOVE from src/core/permissions/)
│   │   ├── engine/            # Permission evaluation engine
│   │   ├── rules/             # Permission rules
│   │   └── store/             # Permission storage
│   ├── types/                 # Core type definitions (CONSOLIDATE from src/types/)
│   │   ├── conversation.ts    # Message types
│   │   ├── tool.ts            # Tool types
│   │   ├── model.ts           # Model types
│   │   └── requestContext.ts  # Request context types
│   └── utils/                 # Core utilities (SELECT from src/utils/)
│       ├── messages/          # Message utilities
│       ├── sandbox/           # Sandbox management
│       ├── session/           # Session management
│       ├── text/              # Text processing utilities
│       └── protocol/          # Protocol utilities (kodeAgent*)
│
├── cli/                       # CLI interface (Ink-based) ✨
│   ├── entrypoint.tsx         # Main CLI entry (MOVE from src/entrypoints/cli.tsx)
│   ├── components/            # Ink components (MOVE from src/ui/components/)
│   │   ├── messages/          # Message rendering components
│   │   │   ├── AssistantTextMessage.tsx
│   │   │   ├── AssistantBashOutputMessage.tsx
│   │   │   ├── AssistantToolUseMessage.tsx
│   │   │   ├── UserPromptMessage.tsx
│   │   │   └── UserToolResultMessage.tsx
│   │   ├── permissions/       # Permission request dialogs
│   │   │   ├── BashPermissionRequest.tsx
│   │   │   ├── FileEditPermissionRequest.tsx
│   │   │   ├── WebFetchPermissionRequest.tsx
│   │   │   └── AskUserQuestionPermissionRequest.tsx
│   │   ├── Logo.tsx           # CLI welcome screen
│   │   ├── PromptInput.tsx    # User input component
│   │   ├── Message.tsx        # Message wrapper
│   │   ├── Spinner.tsx        # Loading indicator
│   │   ├── TodoItem.tsx       # Todo list item
│   │   ├── ModelSelector.tsx
│   │   ├── Config.tsx
│   │   └── ... (50+ components)
│   ├── screens/               # Full-screen Ink UIs (MOVE from src/ui/screens/)
│   │   ├── REPL.tsx           # Main REPL interface
│   │   ├── Doctor.tsx         # Diagnostic screen
│   │   ├── LogList.tsx        # Session history viewer
│   │   └── ResumeConversation.tsx
│   ├── hooks/                 # CLI-specific React hooks (MOVE from src/ui/hooks/)
│   │   ├── useTextInput.ts
│   │   ├── useCanUseTool.ts
│   │   ├── useLogMessages.ts
│   │   ├── useArrowKeyHistory.ts
│   │   ├── useCancelRequest.ts
│   │   └── ... (15+ hooks)
│   ├── commands/              # Slash commands (MOVE from src/commands/)
│   │   ├── clear.ts
│   │   ├── mcp.ts
│   │   ├── onboarding.tsx
│   │   ├── help.tsx
│   │   ├── model.tsx
│   │   ├── config.tsx
│   │   └── ... (20+ commands)
│   ├── services/              # CLI-specific services
│   │   ├── notifier.ts        # Desktop notifications (MOVE from src/services/ui/)
│   │   ├── statusline.ts      # Terminal status line
│   │   └── outputStyles.ts    # Output formatting
│   ├── utils/                 # CLI utilities (MOVE from src/entrypoints/cli/)
│   │   ├── printMode.ts       # --print mode handler
│   │   ├── runCli.tsx         # CLI orchestration
│   │   ├── setup.ts           # CLI setup logic
│   │   ├── setupScreens.tsx
│   │   └── bootstrapEnv.ts
│   ├── constants/             # CLI-specific constants
│   │   ├── asteriskAsciiArt.tsx
│   │   └── figures.ts
│   └── context/               # CLI-specific React context
│       └── PermissionContext.tsx
│
├── web/                       # Web UI (Future) - to be designed ✨
│
├── mobile/                    # Mobile app (Future) - to be designed ✨
│
├── shared/                    # Cross-interface shared code ✨
│   ├── types/                 # Shared TypeScript types
│   │   ├── message.ts         # Message type definitions
│   │   ├── tool.ts            # Tool type definitions
│   │   └── api.ts             # API type definitions
│   ├── constants/             # Shared constants (SELECT from src/constants/)
│   │   ├── product.ts         # Product information
│   │   ├── models.ts          # Model definitions
│   │   └── releaseNotes.ts    # Release notes
│   └── utils/                 # Shared utilities
│       ├── validation.ts      # Input validation
│       └── formatting.ts      # Text formatting
│
└── entrypoints/               # Build entry points for user interfaces only ✨
    ├── cli.tsx                # Re-export from cli/entrypoint.tsx
    ├── web.ts                 # Re-export from web/ (future)
    └── mobile.tsx             # Re-export from mobile/ (future)
```

---

## Benefits of Refactoring

### 1. Clear Boundaries

**Before** (Confusing):
```typescript
import { Logo } from '@ui/components/Logo'  // Is this generic or CLI-specific?
```

**After** (Crystal clear):
```typescript
import { Logo } from '@cli/components/Logo'  // Clearly CLI-specific
import { ChatBubble } from '@web/components/ChatBubble'  // Clearly Web-specific
import { query } from '@core/agent/orchestrator'  // Clearly core logic
```

### 2. Independent Packaging

```json
// package.json
{
  "exports": {
    "./cli": "./dist/interfaces/cli/entrypoint.js",
    "./web": "./dist/interfaces/web/server/index.js",
    "./core": "./dist/core/index.js"  // Can publish as standalone package
  }
}
```

### 3. Team Collaboration

```
Frontend Team:  Focus on interfaces/web/client/
Backend Team:   Focus on interfaces/web/server/ + core/
CLI Team:       Focus on interfaces/cli/
Core Team:      Focus on core/
```

### 4. Dependency Management

```json
// interfaces/cli/package.json
{
  "dependencies": {
    "ink": "^4.0.0",           // CLI-specific
    "yoga-wasm-web": "^0.3.3",
    "chalk": "^5.4.1"
  }
}

// interfaces/web/package.json
{
  "dependencies": {
    "express": "^4.18.0",      // Web-specific
    "react": "^18.0.0",
    "socket.io": "^4.5.0",
    "recharts": "^2.5.0"
  }
}

// core/package.json (minimal dependencies)
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",  // Core only
    "better-sqlite3": "12.6.0"
  }
}
```

### 5. Code Reusability

**Core logic is 100% reusable**:
```typescript
// Both CLI and Web use the same core
import { query } from '@core/agent/orchestrator'

// CLI usage
for await (const msg of query(...)) {
  renderToTerminal(msg)  // Ink rendering
}

// Web usage
for await (const msg of query(...)) {
  ws.send(JSON.stringify(msg))  // WebSocket streaming
}
```

---

## Architecture Validation

### Core Layer (UI-Agnostic) ✅

**What belongs here**:
- ✅ `query()` orchestrator function
- ✅ Tool implementations (BashTool, FileEditTool, etc.)
- ✅ LLM service integrations
- ✅ Permission engine logic
- ✅ Message type definitions
- ✅ Configuration management

**What does NOT belong**:
- ❌ Ink components
- ❌ React components
- ❌ WebSocket handlers
- ❌ Express routes
- ❌ UI-specific hooks
- ❌ MCP server implementation (that's a protocol server, not core logic)
- ❌ MCP server implementation (that's a protocol server, not core logic)

### Interface Layer (UI-Specific) ✅

**CLI (`interfaces/cli/`)**:
- ✅ Ink components and screens
- ✅ Terminal rendering logic
- ✅ CLI-specific commands
- ✅ Print mode handler
- ✅ yoga-wasm setup

**Web (`interfaces/web/`)**:
- ✅ Express server setup
- ✅ React components
- ✅ WebSocket/SSE streaming
- ✅ REST API routes
- ✅ Web-specific authentication

---
 

## Success Criteria

### Must Have ✅
- [ ] All existing tests pass
- [ ] CLI works identically to before
- [ ] Clear separation between core and interface layers
- [ ] TypeScript compilation succeeds
- [ ] Build scripts work correctly

### Nice to Have 🎯
- [ ] Core layer can be published as standalone npm package
- [ ] Documentation updated to reflect new structure
- [ ] AGENTS.md updated with new architecture
- [ ] CI/CD pipeline adjusted for new structure

---

## Risk Mitigation

### Risk 1: Breaking Changes During Migration
**Mitigation**: 
- Migrate incrementally (one module at a time)
- Keep legacy path aliases during transition
- Run full test suite after each migration step

### Risk 2: Import Path Confusion
**Mitigation**:
- Use ESLint rules to enforce correct import paths
- Document import conventions in CONTRIBUTING.md
- Use automated refactoring tools (jscodeshift)

### Risk 3: Dependency Conflicts
**Mitigation**:
- Audit dependencies before migration
- Separate package.json files per interface
- Use workspace features (npm/yarn/pnpm workspaces)
 
 
---

## Appendix: Import Path Examples

### Before Refactor
```typescript
import { query } from '@query'
import { Logo } from '@components/Logo'
import { BashTool } from '@tools/BashTool/BashTool'
import { queryLLM } from '@services/llmLazy'
```

### After Refactor
```typescript
// Core imports (UI-agnostic)
import { query } from '@core/agent/orchestrator'
import { BashTool } from '@core/tools/system/BashTool'
import { queryLLM } from '@core/services/ai/llmLazy'

// CLI imports (terminal-specific)
import { Logo } from '@cli/components/Logo'
import { REPL } from '@cli/components/REPL'

// Web imports (browser-specific)
import { ChatInterface } from '@web/client/components/ChatInterface'
import { createChatServer } from '@web/server'

// Shared imports
import { Message } from '@shared/types/message'
```

---

**Document Version**: 1.0  
**Last Updated**: 2026-01-16  
**Author**: CORINT Development Team
