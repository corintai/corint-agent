export const PROMPT = `Analyze local CSV, Parquet, JSON, or JSONL files with SQL using DuckDB.

Guidelines:
- Provide an absolute file path
- Start with a preview query (e.g. LIMIT 20) to inspect columns and types
- Use FROM data in your query to reference the file
- Always set a reasonable LIMIT for large files
- Use this tool for local files (not configured data sources)

Example:
AnalyzeLocalFile({
  filePath: '/data/sales.csv',
  query: 'SELECT category, SUM(amount) FROM data GROUP BY category',
  limit: 100
})`
