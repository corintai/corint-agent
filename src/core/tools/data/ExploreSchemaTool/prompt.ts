import type { DataSourceSummary } from '@services/datasource'

export function getExploreSchemaPrompt(
  sources: DataSourceSummary[],
): string {
  const sourceList =
    sources.length > 0
      ? sources.map(s => `- ${s.name} (${s.type})`).join('\n')
      : 'No data sources configured'

  return `Explore database schema to understand table structures.

Available data sources:
${sourceList}

Usage:
- List all tables: ExploreSchema(datasource="risk_db")
- Get table details: ExploreSchema(datasource="risk_db", table="applications")
- Explore specific schema: ExploreSchema(datasource="risk_db", schema="analytics")

This tool helps you understand the database structure before writing queries.`
}
