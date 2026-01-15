# CORINT Risk Agent

AI-native assistant for risk management professionals.

## Overview

CORINT Risk Agent is a powerful CLI tool that helps risk management teams with:

- **Data Analysis**: Query and explore risk databases (PostgreSQL, MySQL, ClickHouse)
- **Schema Discovery**: Understand database structures and relationships
- **Multi-Model Support**: Leverage multiple AI models for different tasks
- **Workflow Automation**: Automate repetitive risk analysis tasks

## Installation

```bash
npm install -g @corint/risk-agent
```

After installation, use:
- `corint` - Primary command
- `risk-agent` - Alternative command

## Quick Start

```bash
# Start interactive mode
corint

# Configure your first data source
/config
```

## Data Source Configuration

Create `repository/datasource.yaml` in your project:

```yaml
datasource:
  risk_db:
    type: postgres
    host: ${DB_HOST}
    port: 5432
    database: risk_data
    user: ${DB_USER}
    password: ${DB_PASSWORD}

  analytics:
    type: clickhouse
    url: ${CLICKHOUSE_URL}
```

Or use environment variables:

```bash
export CORINT_DS_RISK_DB_TYPE=postgres
export CORINT_DS_RISK_DB_HOST=localhost
export CORINT_DS_RISK_DB_DATABASE=risk_data
```

## Available Tools

### Data Tools
- **ListDataSources** - List configured data sources
- **ExploreSchema** - Explore database schema and table structures
- **QuerySQL** - Execute SQL queries against data sources

### General Tools
- **FileRead/FileEdit/FileWrite** - File operations
- **Bash** - Execute shell commands
- **WebSearch/WebFetch** - Web research
- **Task** - Delegate tasks to subagents
- **AskExpertModel** - Consult specific AI models

## Commands

- `/help` - Show available commands
- `/model` - Configure AI models
- `/config` - Open configuration panel
- `/cost` - Show token usage and costs
- `/clear` - Clear conversation history
- `/compact` - Compress conversation context

## Example Usage

```bash
# List available data sources
> List my data sources

# Explore database schema
> Show me the tables in risk_db

# Query data
> Get the top 10 rules by hit count from risk_db

# Analyze trends
> Analyze the approval rate trend over the last 30 days
```

## Development

```bash
# Install dependencies
bun install

# Run in development mode
bun run dev

# Build
bun run build

# Run tests
bun test
```

## License

MIT License

## Support

- [GitHub Issues](https://github.com/corintai/corint-agent/issues)
