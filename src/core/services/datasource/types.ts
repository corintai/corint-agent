import type { Pool } from 'pg'
import type { Pool as MySQLPool } from 'mysql2/promise'
import type { ClickHouseClient } from '@clickhouse/client'
import type { Database } from 'bun:sqlite'

export type DataSourceType = 'postgres' | 'mysql' | 'clickhouse' | 'sqlite' | 'databricks'

export interface DatabricksClient {
  host: string
  accessToken: string
  httpPath: string
  catalog?: string
  schema?: string
}

export interface DataSourceConfig {
  type: DataSourceType
  url?: string
  host?: string
  port?: number
  user?: string
  password?: string
  database?: string
  ssl?: boolean
  maxConnections?: number
  accessToken?: string
  httpPath?: string
  catalog?: string
  schema?: string
}

export type DataSourceClient =
  | { type: 'postgres'; client: Pool; config: DataSourceConfig }
  | { type: 'mysql'; client: MySQLPool; config: DataSourceConfig }
  | { type: 'clickhouse'; client: ClickHouseClient; config: DataSourceConfig }
  | { type: 'sqlite'; client: Database; config: DataSourceConfig }
  | { type: 'databricks'; client: DatabricksClient; config: DataSourceConfig }

export interface DataSourceSummary {
  name: string
  type: DataSourceType
}

export interface QueryResult {
  columns: string[]
  rows: Record<string, unknown>[]
  rowCount: number
  executionTimeMs: number
}

export interface SchemaInfo {
  tables: TableInfo[]
}

export interface TableInfo {
  name: string
  schema?: string
  columns: ColumnInfo[]
  rowCount?: number
}

export interface ColumnInfo {
  name: string
  type: string
  nullable: boolean
  isPrimaryKey?: boolean
  defaultValue?: string
  comment?: string
}
