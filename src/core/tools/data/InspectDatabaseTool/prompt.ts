export const PROMPT = `Inspect database structures and data sources.

This tool provides hierarchical database exploration:
1. List all configured data sources (no parameters)
2. List tables in a data source (datasource parameter)
3. View detailed table schema (datasource + table parameters)

Parameters:
- datasource: Data source name (omit to list all sources)
- table: Specific table for detailed schema
- schema: Database schema/namespace (default: public/default)
- pattern: Filter tables by name pattern (SQL LIKE: % = any chars, _ = one char)
- limit: Max tables to return (default: 100, max: 10000)
- timeout: Query timeout in ms (default: 30000)

Examples:

# List all data sources
InspectDatabase()

# List first 100 tables in a data source
InspectDatabase({ datasource: "risk_db" })

# List tables matching pattern
InspectDatabase({ datasource: "risk_db", pattern: "user_%" })

# Get more tables
InspectDatabase({ datasource: "risk_db", limit: 500 })

# View specific table schema
InspectDatabase({ datasource: "risk_db", table: "applications" })

# Explore specific schema
InspectDatabase({ datasource: "risk_db", schema: "analytics" })

Use this tool to discover available data before writing queries with QuerySQL.`
