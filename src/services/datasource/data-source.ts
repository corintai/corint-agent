import fs from 'fs'
import path from 'path'
import { Pool } from 'pg'
import * as mysql from 'mysql2/promise'
import { createClient } from '@clickhouse/client'
import type { ClickHouseClient } from '@clickhouse/client'
import { Database } from 'bun:sqlite'
import yaml from 'yaml'
import type {
  DataSourceType,
  DataSourceConfig,
  DataSourceClient,
  DataSourceSummary,
} from './types'

const dataSourceCache = new Map<string, DataSourceClient>()
let yamlCache:
  | {
      path: string
      mtimeMs: number
      configs: Record<string, DataSourceConfig>
      summaries: DataSourceSummary[]
    }
  | undefined

export function getDataSourceConfig(name: string): DataSourceConfig {
  const normalized = normalizeName(name)

  const fromYaml = parseYamlDataSource(name)
  if (fromYaml) {
    return fromYaml
  }

  const fromEnvJson = parseDataSourcesEnv(name)
  if (fromEnvJson) {
    return fromEnvJson
  }

  const fromPrefix = parseEnvPrefix(normalized)
  if (fromPrefix) {
    return fromPrefix
  }

  const knownSources = listDataSources()
  const hint =
    knownSources.length > 0
      ? ` Known sources: ${knownSources.map(source => source.name).join(', ')}.`
      : ''

  throw new Error(
    `Data source ${name} not configured. Set repository/datasource.yaml, CORINT_DATA_SOURCES, or CORINT_DS_${normalized}_TYPE.${hint}`,
  )
}

export async function getDataSourceClient(
  name: string,
): Promise<DataSourceClient> {
  const cached = dataSourceCache.get(name)
  if (cached) {
    return cached
  }

  const config = getDataSourceConfig(name)
  let client: DataSourceClient

  switch (config.type) {
    case 'postgres':
      client = {
        type: 'postgres',
        config,
        client: new Pool(buildPostgresConfig(config)),
      }
      break
    case 'mysql':
      client = {
        type: 'mysql',
        config,
        client: mysql.createPool(buildMySQLConfig(config)),
      }
      break
    case 'clickhouse':
      client = {
        type: 'clickhouse',
        config,
        client: createClient(buildClickHouseConfig(config)),
      }
      break
    case 'sqlite':
      client = {
        type: 'sqlite',
        config,
        client: buildSQLiteClient(config),
      }
      break
    default:
      throw new Error(`Unsupported data source type: ${config.type}`)
  }

  dataSourceCache.set(name, client)
  return client
}

export function listDataSources(): DataSourceSummary[] {
  const summaries: DataSourceSummary[] = []
  const seen = new Set<string>()

  const fromYaml = parseYamlDataSourcesAll()
  for (const source of fromYaml) {
    if (seen.has(source.name)) {
      continue
    }
    seen.add(source.name)
    summaries.push(source)
  }

  const fromEnvJson = parseDataSourcesEnvAll()
  for (const source of fromEnvJson) {
    if (seen.has(source.name)) {
      continue
    }
    seen.add(source.name)
    summaries.push(source)
  }

  const fromPrefix = parseEnvPrefixAll()
  for (const source of fromPrefix) {
    if (seen.has(source.name)) {
      continue
    }
    seen.add(source.name)
    summaries.push(source)
  }

  return summaries
}

function parseYamlDataSource(name: string): DataSourceConfig | undefined {
  const data = loadYamlSources()
  if (!data) {
    return undefined
  }
  const key = name.toLowerCase()
  return data.configs[key]
}

function parseYamlDataSourcesAll(): DataSourceSummary[] {
  const data = loadYamlSources()
  return data ? data.summaries : []
}

function loadYamlSources():
  | {
      configs: Record<string, DataSourceConfig>
      summaries: DataSourceSummary[]
    }
  | undefined {
  const configPath = resolveYamlPath()
  if (!configPath) {
    return undefined
  }

  const stat = fs.statSync(configPath)
  if (
    yamlCache &&
    yamlCache.path === configPath &&
    yamlCache.mtimeMs === stat.mtimeMs
  ) {
    return { configs: yamlCache.configs, summaries: yamlCache.summaries }
  }

  const raw = fs.readFileSync(configPath, 'utf8')
  const parsed = yaml.parse(raw) as unknown
  const { configs, summaries } = normalizeYamlSources(parsed)

  yamlCache = {
    path: configPath,
    mtimeMs: stat.mtimeMs,
    configs,
    summaries,
  }

  return { configs, summaries }
}

function resolveYamlPath(): string | undefined {
  const envPath = process.env.CORINT_DATASOURCE_PATH
  if (envPath) {
    const resolved = path.resolve(envPath)
    if (fs.existsSync(resolved)) {
      return resolved
    }
  }

  return findUpwardsConfig(process.cwd())
}

function findUpwardsConfig(startDir: string): string | undefined {
  let current = startDir
  while (true) {
    const candidate = path.join(current, 'repository', 'datasource.yaml')
    if (fs.existsSync(candidate)) {
      return candidate
    }
    const parent = path.dirname(current)
    if (parent === current) {
      return undefined
    }
    current = parent
  }
}

function normalizeYamlSources(parsed: unknown): {
  configs: Record<string, DataSourceConfig>
  summaries: DataSourceSummary[]
} {
  let sourceBlock = parsed
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const root = parsed as Record<string, unknown>
    if (root.datasource) {
      sourceBlock = root.datasource
    } else if (root.data_sources) {
      sourceBlock = root.data_sources
    } else if (root.datasources) {
      sourceBlock = root.datasources
    }
  }

  const configs: Record<string, DataSourceConfig> = {}
  const summaries: DataSourceSummary[] = []

  if (Array.isArray(sourceBlock)) {
    for (const entry of sourceBlock) {
      if (!entry || typeof entry !== 'object') {
        continue
      }
      const name = String((entry as { name?: string }).name || '').trim()
      if (!name) {
        continue
      }
      const config = normalizeConfig(entry as Record<string, unknown>)
      if (!config.type) {
        continue
      }
      const key = name.toLowerCase()
      if (!configs[key]) {
        configs[key] = config
        summaries.push({ name, type: config.type })
      }
    }
  } else if (sourceBlock && typeof sourceBlock === 'object') {
    for (const [name, value] of Object.entries(
      sourceBlock as Record<string, unknown>,
    )) {
      if (!value || typeof value !== 'object') {
        continue
      }
      const config = normalizeConfig(value as Record<string, unknown>)
      if (!config.type) {
        continue
      }
      const key = name.toLowerCase()
      if (!configs[key]) {
        configs[key] = config
        summaries.push({ name, type: config.type })
      }
    }
  }

  return { configs, summaries }
}

function parseDataSourcesEnv(name: string): DataSourceConfig | undefined {
  const raw = process.env.CORINT_DATA_SOURCES
  if (!raw) {
    return undefined
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) {
      const match = parsed.find(
        entry => entry && (entry as { name?: string }).name === name,
      )
      return match
        ? normalizeConfig(match as Record<string, unknown>)
        : undefined
    }
    if (parsed && typeof parsed === 'object') {
      const entry = (parsed as Record<string, unknown>)[name]
      return entry
        ? normalizeConfig(entry as Record<string, unknown>)
        : undefined
    }
  } catch (error) {
    console.error('Failed to parse CORINT_DATA_SOURCES:', error)
  }

  return undefined
}

function parseDataSourcesEnvAll(): DataSourceSummary[] {
  const raw = process.env.CORINT_DATA_SOURCES
  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) {
      return parsed
        .filter(entry => entry && typeof entry === 'object')
        .map(entry => ({
          name: String((entry as { name?: string }).name || ''),
          type: resolveProviderType(entry as Record<string, unknown>),
        }))
        .filter(entry => entry.name && entry.type)
    }
    if (parsed && typeof parsed === 'object') {
      return Object.entries(parsed as Record<string, unknown>)
        .map(([name, value]) => ({
          name,
          type: resolveProviderType(value as Record<string, unknown>),
        }))
        .filter(entry => entry.name && entry.type)
    }
  } catch (error) {
    console.error('Failed to parse CORINT_DATA_SOURCES:', error)
  }

  return []
}

function parseEnvPrefix(normalizedName: string): DataSourceConfig | undefined {
  const prefix = `CORINT_DS_${normalizedName}_`
  const typeRaw = process.env[`${prefix}TYPE`]
  const type = typeRaw
    ? (String(typeRaw).toLowerCase() as DataSourceType)
    : undefined
  if (!type) {
    return undefined
  }

  const config: DataSourceConfig = {
    type,
    url: process.env[`${prefix}URL`],
    host: process.env[`${prefix}HOST`],
    port: parseNumber(process.env[`${prefix}PORT`]),
    user: process.env[`${prefix}USER`],
    password: process.env[`${prefix}PASSWORD`],
    database: process.env[`${prefix}DATABASE`] || process.env[`${prefix}DB`],
    ssl: parseBoolean(process.env[`${prefix}SSL`]),
    maxConnections: parseNumber(process.env[`${prefix}MAX_CONNECTIONS`]),
  }

  return config
}

function parseEnvPrefixAll(): DataSourceSummary[] {
  const summaries: DataSourceSummary[] = []

  for (const key of Object.keys(process.env)) {
    if (!key.startsWith('CORINT_DS_') || !key.endsWith('_TYPE')) {
      continue
    }
    const namePart = key.slice('CORINT_DS_'.length, -'_TYPE'.length)
    const typeRaw = process.env[key]
    const type = typeRaw
      ? (String(typeRaw).toLowerCase() as DataSourceType)
      : undefined
    if (!type) {
      continue
    }
    summaries.push({
      name: denormalizeName(namePart),
      type,
    })
  }

  return summaries
}

function normalizeConfig(input: Record<string, unknown>): DataSourceConfig {
  return {
    type: resolveProviderType(input),
    url:
      asString(input.url) ||
      asString(input.connection_string) ||
      asString(input.connectionString),
    host: asString(input.host),
    port: asNumber(input.port),
    user: asString(input.user),
    password: asString(input.password),
    database: asString(input.database),
    ssl: asBoolean(input.ssl),
    maxConnections: asNumber(
      extractOption(input.options, 'max_connections') ??
        extractOption(input.options, 'maxConnections') ??
        input.max_connections,
    ),
  }
}

function buildPostgresConfig(config: DataSourceConfig): {
  connectionString?: string
  host?: string
  port?: number
  user?: string
  password?: string
  database?: string
  ssl?: { rejectUnauthorized: boolean } | undefined
  max?: number
} {
  return {
    connectionString: config.url,
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
    max: config.maxConnections,
  }
}

function buildMySQLConfig(config: DataSourceConfig): {
  uri?: string
  host?: string
  port?: number
  user?: string
  password?: string
  database?: string
  ssl?: Record<string, unknown>
  connectionLimit?: number
  waitForConnections: boolean
} {
  return {
    uri: config.url,
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl: config.ssl ? {} : undefined,
    connectionLimit: config.maxConnections,
    waitForConnections: true,
  }
}

function buildClickHouseConfig(config: DataSourceConfig): {
  url?: string
  username?: string
  password?: string
  database?: string
} {
  const url =
    config.url ||
    (config.host
      ? `${config.ssl ? 'https' : 'http'}://${config.host}:${config.port || 8123}`
      : undefined)

  return {
    url,
    username: config.user,
    password: config.password,
    database: config.database,
  }
}

function buildSQLiteClient(config: DataSourceConfig): Database {
  let dbPath = config.url || config.database
  if (!dbPath) {
    throw new Error('SQLite requires url or database path')
  }

  // Remove sqlite:// protocol prefix if present
  if (dbPath.startsWith('sqlite://')) {
    dbPath = dbPath.substring('sqlite://'.length)
  }

  // Resolve relative paths
  if (!path.isAbsolute(dbPath)) {
    dbPath = path.resolve(process.cwd(), dbPath)
  }

  return new Database(dbPath, { readonly: true })
}

function normalizeName(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]/g, '_')
}

function denormalizeName(name: string): string {
  return name.toLowerCase()
}

function parseNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (!value) {
    return undefined
  }
  if (value === 'true' || value === '1') {
    return true
  }
  if (value === 'false' || value === '0') {
    return false
  }
  return undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? expandEnvString(value) : undefined
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') {
      return true
    }
    if (value.toLowerCase() === 'false') {
      return false
    }
  }
  return undefined
}

function expandEnvString(value: string): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (match, name) => {
    const envValue = process.env[name]
    return envValue !== undefined ? envValue : match
  })
}

function resolveProviderType(input: Record<string, unknown>): DataSourceType {
  const raw = String(input.type || input.provider || '').toLowerCase()
  if (raw === 'postgresql' || raw === 'postgres') {
    return 'postgres'
  }
  if (raw === 'mysql') {
    return 'mysql'
  }
  if (raw === 'clickhouse') {
    return 'clickhouse'
  }
  if (raw === 'sqlite' || raw === 'sqlite3') {
    return 'sqlite'
  }
  return raw as DataSourceType
}

function extractOption(options: unknown, key: string): unknown {
  if (!options || typeof options !== 'object') {
    return undefined
  }
  return (options as Record<string, unknown>)[key]
}

export async function closeAllConnections(): Promise<void> {
  for (const [name, client] of dataSourceCache) {
    try {
      if (client.type === 'postgres') {
        await client.client.end()
      } else if (client.type === 'mysql') {
        await client.client.end()
      } else if (client.type === 'clickhouse') {
        await client.client.close()
      } else if (client.type === 'sqlite') {
        client.client.close()
      }
    } catch (error) {
      console.error(`Failed to close connection for ${name}:`, error)
    }
  }
  dataSourceCache.clear()
}
