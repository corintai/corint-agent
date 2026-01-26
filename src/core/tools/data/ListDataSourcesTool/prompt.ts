export const PROMPT = `List all configured data sources.

This tool shows all available database connections that can be used with QuerySQL and ExploreSchema tools.

Data sources can be configured via:
- repository/datasource.yaml file
- CORINT_DATA_SOURCES environment variable (JSON)
- CORINT_DS_<NAME>_TYPE environment variables

Use this tool first to discover available data sources before running queries.`
