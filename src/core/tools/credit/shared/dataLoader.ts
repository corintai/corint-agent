import { getDataSourceClient } from '@services/datasource'
import { readFile } from 'fs/promises'
import { parse } from 'csv-parse/sync'

export interface DataFrame {
  columns: string[]
  rows: Record<string, any>[]
  rowCount: number
}

export async function loadData(params: {
  datasource?: string
  table?: string
  filePath?: string
  sampleSize?: number
}): Promise<DataFrame> {
  if (params.filePath) {
    return await loadLocalFile(params.filePath, params.sampleSize)
  } else if (params.datasource && params.table) {
    return await loadFromDatabase(
      params.datasource,
      params.table,
      params.sampleSize,
    )
  } else {
    throw new Error('Must provide either filePath or (datasource + table)')
  }
}

async function loadLocalFile(
  filePath: string,
  sampleSize?: number,
): Promise<DataFrame> {
  const ext = filePath.toLowerCase().split('.').pop()

  if (ext === 'csv') {
    return await loadCSV(filePath, sampleSize)
  } else if (ext === 'parquet') {
    throw new Error('Parquet format not yet supported')
  } else if (ext === 'xlsx' || ext === 'xls') {
    throw new Error('Excel format not yet supported')
  } else {
    throw new Error(`Unsupported file format: ${ext}`)
  }
}

async function loadCSV(
  filePath: string,
  sampleSize?: number,
): Promise<DataFrame> {
  const content = await readFile(filePath, 'utf-8')
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    cast: true,
  }) as Record<string, any>[]

  const sampledRows =
    sampleSize && records.length > sampleSize
      ? records.slice(0, sampleSize)
      : records

  const columns = sampledRows.length > 0 ? Object.keys(sampledRows[0]) : []

  return {
    columns,
    rows: sampledRows,
    rowCount: sampledRows.length,
  }
}

async function loadFromDatabase(
  datasource: string,
  table: string,
  sampleSize?: number,
): Promise<DataFrame> {
  const client = await getDataSourceClient(datasource)
  const limit = sampleSize || 10000

  let sql = `SELECT * FROM ${table}`

  // Add sampling for large datasets
  if (client.type === 'postgres') {
    sql = `SELECT * FROM ${table} TABLESAMPLE SYSTEM (10) LIMIT ${limit}`
  } else if (client.type === 'mysql') {
    sql = `SELECT * FROM ${table} ORDER BY RAND() LIMIT ${limit}`
  } else {
    sql = `SELECT * FROM ${table} LIMIT ${limit}`
  }

  let columns: string[] = []
  let rows: Record<string, any>[] = []

  if (client.type === 'postgres') {
    const result = await client.client.query(sql)
    columns = result.fields.map(f => f.name)
    rows = result.rows
  } else if (client.type === 'mysql') {
    const [queryRows, fields] = await client.client.query(sql)
    columns = (fields as { name: string }[]).map(f => f.name)
    rows = queryRows as Record<string, any>[]
  } else if (client.type === 'clickhouse') {
    const result = await client.client.query({
      query: sql,
      format: 'JSONEachRow',
    })
    const jsonRows = (await result.json()) as Record<string, any>[]
    rows = jsonRows
    if (rows.length > 0) {
      columns = Object.keys(rows[0])
    }
  } else if (client.type === 'sqlite') {
    const queryRows = client.client.prepare(sql).all() as Record<string, any>[]
    rows = queryRows
    if (rows.length > 0) {
      columns = Object.keys(rows[0])
    }
  } else if (client.type === 'databricks') {
    throw new Error('Databricks not yet supported in dataLoader')
  }

  return {
    columns,
    rows,
    rowCount: rows.length,
  }
}

export function getColumnValues(
  df: DataFrame,
  columnName: string,
): any[] {
  return df.rows.map(row => row[columnName])
}

export function getNumericColumns(df: DataFrame): string[] {
  if (df.rows.length === 0) return []

  return df.columns.filter(col => {
    const values = getColumnValues(df, col)
    const numericCount = values.filter(
      v => typeof v === 'number' && !isNaN(v),
    ).length
    return numericCount / values.length > 0.8 // 80% numeric threshold
  })
}

export function getCategoricalColumns(df: DataFrame): string[] {
  if (df.rows.length === 0) return []

  return df.columns.filter(col => {
    const values = getColumnValues(df, col)
    const uniqueCount = new Set(values).size
    return uniqueCount < values.length * 0.5 // Less than 50% unique
  })
}
