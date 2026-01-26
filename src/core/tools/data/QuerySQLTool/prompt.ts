import type { DataSourceSummary } from '@services/datasource'

export function getQuerySqlPrompt(sources: DataSourceSummary[]): string {
  const sourceList =
    sources.length > 0
      ? sources.map(s => `- ${s.name} (${s.type})`).join('\n')
      : 'No data sources configured'

  return `Execute SQL queries against configured data sources.

Available data sources:
${sourceList}

Guidelines:
- Use SELECT queries for data retrieval
- Always specify a reasonable LIMIT to avoid large result sets
- Use proper table and column names from the schema
- For risk analysis, common tables include: applications, decisions, rules, scores
- Avoid destructive operations (DELETE, DROP, TRUNCATE)

Example usage:
- Query recent applications: SELECT * FROM applications WHERE created_at > NOW() - INTERVAL '7 days' LIMIT 100
- Get rule performance: SELECT rule_id, COUNT(*) as hits FROM rule_hits GROUP BY rule_id`
}
