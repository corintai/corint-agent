# Tools Optimization for Local File Analysis

## Overview

This document outlines the optimization plan for corint-agent's tools to support efficient local file analysis and data processing.

## Current State

### Existing Data Tools

```
src/core/tools/data/
├── QuerySQLTool          # Query remote databases (PostgreSQL, MySQL, ClickHouse, SQLite)
├── ExploreSchemaTool     # Explore database schema
└── ListDataSourcesTool   # List configured data sources
```

**Current Capabilities:**
- ✅ Query remote databases
- ✅ Explore database schemas
- ✅ Support multiple database types

**Limitations:**
- ❌ No support for local file analysis (CSV, Parquet, JSON)
- ❌ No file format conversion tools
- ❌ No DuckDB integration for local analytics
- ❌ No Excel file handling

---

## Optimization Plan

### Phase 1: Core Local File Analysis Tools

#### 1.1 AnalyzeLocalFileTool

**Purpose:** Analyze local CSV/Parquet/JSON files using DuckDB

**Location:** `src/core/tools/data/AnalyzeLocalFileTool/`

**Input Schema:**
```typescript
export const inputSchema = z.strictObject({
  filePath: z.string()
    .describe('Absolute path to CSV/Parquet/JSON file'),
  query: z.string()
    .describe('SQL query to execute on the file'),
  limit: z.number().optional().default(1000)
    .describe('Maximum number of rows to return'),
  format: z.enum(['csv', 'parquet', 'json', 'jsonl', 'auto']).default('auto')
    .describe('File format (auto-detect by default)'),
})
```

**Key Features:**
- Direct query on CSV/Parquet/JSON files without loading into memory
- SQL interface for familiar querying
- Automatic format detection
- Streaming results for large files
- Low memory footprint

**Example Usage:**
```typescript
AnalyzeLocalFile({
  filePath: '/data/sales.csv',
  query: `
    SELECT
      category,
      COUNT(*) as orders,
      SUM(amount) as revenue
    FROM data
    WHERE date >= '2024-01-01'
    GROUP BY category
    ORDER BY revenue DESC
  `,
  limit: 100
})
```

**Implementation:**
```typescript
import duckdb from 'duckdb'

async function executeQuery(filePath: string, query: string, limit: number) {
  const db = new duckdb.Database(':memory:')
  const conn = db.connect()

  // Replace table name with file path
  const fullQuery = query.includes('FROM')
    ? query.replace(/FROM\s+(\w+)/i, `FROM '${filePath}'`)
    : `SELECT * FROM '${filePath}' ${query} LIMIT ${limit}`

  return new Promise((resolve, reject) => {
    conn.all(fullQuery, (err, rows) => {
      if (err) reject(err)
      else resolve(rows)
      conn.close()
      db.close()
    })
  })
}
```

---

#### 1.2 ConvertToParquetTool

**Purpose:** Convert CSV/JSON files to Parquet format for faster analysis

**Location:** `src/core/tools/data/ConvertToParquetTool/`

**Input Schema:**
```typescript
export const inputSchema = z.strictObject({
  inputPath: z.string()
    .describe('Input CSV/JSON file path'),
  outputPath: z.string().optional()
    .describe('Output Parquet file path (default: same name with .parquet extension)'),
  compression: z.enum(['snappy', 'gzip', 'zstd', 'none']).default('zstd')
    .describe('Compression algorithm (zstd recommended)'),
  rowGroupSize: z.number().optional().default(100000)
    .describe('Number of rows per row group'),
  cleanData: z.boolean().optional().default(false)
    .describe('Clean data during conversion (trim strings, remove nulls)'),
})
```

**Key Features:**
- Fast conversion using DuckDB
- Multiple compression options
- Optional data cleaning during conversion
- Progress reporting for large files
- Automatic output path generation

**Example Usage:**
```typescript
ConvertToParquet({
  inputPath: '/data/sales.csv',
  outputPath: '/data/sales.parquet',
  compression: 'zstd',
  cleanData: true
})
```

**Implementation:**
```typescript
import duckdb from 'duckdb'

async function convertToParquet(input: Input) {
  const output = input.outputPath || input.inputPath.replace(/\.(csv|json)$/, '.parquet')

  const db = new duckdb.Database(':memory:')
  const conn = db.connect()

  let sql = `SELECT * FROM '${input.inputPath}'`

  if (input.cleanData) {
    // Add data cleaning logic
    sql = `
      SELECT
        TRIM(column1) as column1,
        CAST(column2 AS INTEGER) as column2
      FROM '${input.inputPath}'
      WHERE column1 IS NOT NULL
    `
  }

  await conn.run(`
    COPY (${sql})
    TO '${output}' (
      FORMAT PARQUET,
      COMPRESSION ${input.compression.toUpperCase()},
      ROW_GROUP_SIZE ${input.rowGroupSize}
    )
  `)

  conn.close()
  db.close()

  return {
    inputFile: input.inputPath,
    outputFile: output,
    compression: input.compression
  }
}
```

---

#### 1.3 ConvertExcelToCSVTool

**Purpose:** Convert Excel files to CSV format

**Location:** `src/core/tools/data/ConvertExcelToCSVTool/`

**Input Schema:**
```typescript
export const inputSchema = z.strictObject({
  inputPath: z.string()
    .describe('Input Excel file path (.xlsx or .xls)'),
  outputPath: z.string().optional()
    .describe('Output CSV file path (default: same name with .csv extension)'),
  sheetName: z.string().optional()
    .describe('Sheet name to convert (default: first sheet)'),
  convertAllSheets: z.boolean().optional().default(false)
    .describe('Convert all sheets to separate CSV files'),
})
```

**Key Features:**
- Convert single or multiple sheets
- Automatic sheet detection
- Preserve data types
- Handle large Excel files efficiently

**Example Usage:**
```typescript
// Single sheet
ConvertExcelToCSV({
  inputPath: '/data/sales.xlsx',
  outputPath: '/data/sales.csv',
  sheetName: 'Sheet1'
})

// All sheets
ConvertExcelToCSV({
  inputPath: '/data/report.xlsx',
  convertAllSheets: true
})
// Outputs: report_Sheet1.csv, report_Sheet2.csv, etc.
```

**Implementation:**
```typescript
import pandas as pd

async function convertExcelToCSV(input: Input) {
  if (input.convertAllSheets) {
    const excelFile = pd.ExcelFile(input.inputPath)
    const outputs = []

    for (const sheetName of excelFile.sheet_names) {
      const df = pd.read_excel(excelFile, sheet_name=sheetName)
      const outputPath = input.inputPath.replace(/\.xlsx?$/, `_${sheetName}.csv`)
      df.to_csv(outputPath, index=False)
      outputs.push(outputPath)
    }

    return { inputFile: input.inputPath, outputFiles: outputs }
  } else {
    const df = pd.read_excel(input.inputPath, sheet_name=input.sheetName)
    const output = input.outputPath || input.inputPath.replace(/\.xlsx?$/, '.csv')
    df.to_csv(output, index=False)

    return { inputFile: input.inputPath, outputFile: output }
  }
}
```

---

### Phase 2: Tool Design Philosophy

#### 2.1 Why NOT Add DuckDB as DataSource?

**Key Insight:** Local file analysis is fundamentally different from database connections.

**Remote Databases (PostgreSQL, MySQL, etc.):**
- ✅ Persistent connections
- ✅ Configured once, used repeatedly
- ✅ Stable connection parameters
- ✅ Suitable for datasource.yaml

**Local Files:**
- ❌ Temporary analysis
- ❌ Dynamic file paths
- ❌ No persistent connection needed
- ❌ NOT suitable for datasource.yaml

**Design Decision:**
- **AnalyzeLocalFileTool** uses DuckDB internally
- **No DuckDB datasource configuration needed**
- **Direct file path in tool parameters**
- **QuerySQLTool remains for remote databases only**

#### 2.2 Tool Independence

**AnalyzeLocalFileTool is self-contained:**
```typescript
// No datasource configuration needed!
AnalyzeLocalFile({
  filePath: '/tmp/analysis/sales.csv',  // Direct file path
  query: 'SELECT * FROM data LIMIT 10'
})

// Different file, different analysis
AnalyzeLocalFile({
  filePath: '/downloads/report.parquet',  // Another file
  query: 'SELECT category, SUM(amount) FROM data GROUP BY category'
})
```

**Benefits:**
- ✅ No configuration overhead
- ✅ Works with any file path
- ✅ Suitable for temporary files
- ✅ Simple and intuitive
- ✅ No datasource.yaml pollution

**Comparison:**

| Aspect | Remote DB (QuerySQLTool) | Local Files (AnalyzeLocalFileTool) |
|--------|-------------------------|-----------------------------------|
| Configuration | datasource.yaml | None (direct file path) |
| Connection | Persistent | Temporary (per query) |
| Use Case | Repeated queries | Ad-hoc analysis |
| Lifecycle | Long-lived | Short-lived |

### Phase 3: Enhanced Features

#### 3.1 DataProfileTool

**Purpose:** Generate statistical profile of data files

**Input Schema:**
```typescript
export const inputSchema = z.strictObject({
  filePath: z.string(),
  columns: z.array(z.string()).optional()
    .describe('Specific columns to profile (default: all)'),
})
```

**Output:**
- Row count
- Column types
- Missing values count
- Min/max/mean/median for numeric columns
- Unique values count for categorical columns
- Data distribution

**Example:**
```typescript
DataProfile({
  filePath: '/data/sales.csv'
})

// Returns:
{
  rowCount: 1000000,
  columns: [
    {
      name: 'amount',
      type: 'DOUBLE',
      nullCount: 0,
      min: 10.5,
      max: 9999.99,
      mean: 234.56,
      median: 189.00
    },
    {
      name: 'category',
      type: 'VARCHAR',
      nullCount: 5,
      uniqueCount: 12,
      topValues: ['Electronics', 'Clothing', 'Food']
    }
  ]
}
```

---

#### 3.2 MergeFilesTool

**Purpose:** Merge multiple CSV/Parquet files into one

**Input Schema:**
```typescript
export const inputSchema = z.strictObject({
  inputPaths: z.array(z.string())
    .describe('Array of file paths to merge'),
  outputPath: z.string()
    .describe('Output file path'),
  format: z.enum(['csv', 'parquet']).default('parquet')
    .describe('Output format'),
})
```

**Example:**
```typescript
MergeFiles({
  inputPaths: [
    '/data/sales_2023.csv',
    '/data/sales_2024.csv',
    '/data/sales_2025.csv'
  ],
  outputPath: '/data/sales_all.parquet',
  format: 'parquet'
})
```

---

#### 3.3 PartitionDataTool

**Purpose:** Partition large files by column values

**Input Schema:**
```typescript
export const inputSchema = z.strictObject({
  inputPath: z.string(),
  outputDir: z.string(),
  partitionBy: z.array(z.string())
    .describe('Columns to partition by (e.g., ["year", "month"])'),
})
```

**Example:**
```typescript
PartitionData({
  inputPath: '/data/sales.csv',
  outputDir: '/data/sales_partitioned',
  partitionBy: ['year', 'month']
})

// Creates:
// /data/sales_partitioned/year=2024/month=01/data.parquet
// /data/sales_partitioned/year=2024/month=02/data.parquet
// ...
```

---

## Implementation Priority

### High Priority (Phase 1)
1. ✅ **AnalyzeLocalFileTool** - Core functionality for local file analysis
2. ✅ **ConvertToParquetTool** - Essential for performance optimization
3. ✅ **ConvertExcelToCSVTool** - Common use case for Excel files

**Note:** DuckDB is used internally by these tools, NOT as a datasource type.

### Medium Priority (Phase 2)
4. **DataProfileTool** - Useful for data exploration
5. **MergeFilesTool** - Common data preparation task

### Low Priority (Phase 3)
6. **PartitionDataTool** - Advanced feature for very large files

---

## Dependencies

### Required Packages

```json
{
  "dependencies": {
    "duckdb": "^1.0.0",
    "pandas": "^2.0.0",  // For Excel conversion (Python)
    "xlsx": "^0.18.0"    // Alternative: Node.js Excel library
  }
}
```

### Installation

```bash
# DuckDB
npm install duckdb
# or
bun add duckdb

# For Excel conversion (Python approach)
pip install pandas openpyxl

# For Excel conversion (Node.js approach)
npm install xlsx
```

---

## Tool Organization

### Updated Directory Structure

```
src/core/tools/data/
├── QuerySQLTool/
├── ExploreSchemaTool/
├── ListDataSourcesTool/
├── AnalyzeLocalFileTool/        # New
├── ConvertToParquetTool/        # New
├── ConvertExcelToCSVTool/       # New
├── DataProfileTool/             # New (Phase 2)
├── MergeFilesTool/              # New (Phase 2)
└── PartitionDataTool/           # New (Phase 3)
```

### Updated index.ts

```typescript
export { QuerySQLTool } from './QuerySQLTool/QuerySQLTool'
export { ExploreSchemaTool } from './ExploreSchemaTool/ExploreSchemaTool'
export { ListDataSourcesTool } from './ListDataSourcesTool/ListDataSourcesTool'
export { AnalyzeLocalFileTool } from './AnalyzeLocalFileTool/AnalyzeLocalFileTool'
export { ConvertToParquetTool } from './ConvertToParquetTool/ConvertToParquetTool'
export { ConvertExcelToCSVTool } from './ConvertExcelToCSVTool/ConvertExcelToCSVTool'
export { DataProfileTool } from './DataProfileTool/DataProfileTool'
export { MergeFilesTool } from './MergeFilesTool/MergeFilesTool'
export { PartitionDataTool } from './PartitionDataTool/PartitionDataTool'
```

---

## Usage Workflows

### Workflow 1: Analyze Small CSV File

```typescript
// Direct analysis (< 100MB)
AnalyzeLocalFile({
  filePath: '/data/sales.csv',
  query: 'SELECT category, SUM(amount) FROM data GROUP BY category'
})
```

### Workflow 2: Analyze Large CSV File

```typescript
// Step 1: Convert to Parquet
ConvertToParquet({
  inputPath: '/data/large_sales.csv',
  outputPath: '/data/large_sales.parquet',
  compression: 'zstd'
})

// Step 2: Analyze Parquet (50-100x faster)
AnalyzeLocalFile({
  filePath: '/data/large_sales.parquet',
  query: 'SELECT * FROM data WHERE amount > 1000'
})
```

### Workflow 3: Analyze Excel File

```typescript
// Step 1: Convert Excel to CSV
ConvertExcelToCSV({
  inputPath: '/data/report.xlsx',
  outputPath: '/data/report.csv'
})

// Step 2: Convert CSV to Parquet (if > 100MB)
ConvertToParquet({
  inputPath: '/data/report.csv',
  outputPath: '/data/report.parquet'
})

// Step 3: Analyze
AnalyzeLocalFile({
  filePath: '/data/report.parquet',
  query: 'SELECT * FROM data'
})
```

### Workflow 4: Tool Independence

```typescript
// Local file analysis - No datasource configuration!
AnalyzeLocalFile({
  filePath: '/tmp/sales.csv',
  query: 'SELECT * FROM data WHERE amount > 1000'
})

// Remote database - Uses datasource configuration
QuerySQL({
  datasource: 'production_db',  // Configured in datasource.yaml
  sql: 'SELECT * FROM sales WHERE amount > 1000'
})

// Clear separation of concerns:
// - AnalyzeLocalFileTool: Temporary files, direct paths
// - QuerySQLTool: Persistent databases, configured connections
```

---

## Benefits

### Performance Improvements
- **50-100x faster** queries on Parquet vs CSV
- **5-10x smaller** file sizes with compression
- **10-100x lower** memory usage with streaming

### User Experience
- **Simple workflow**: Excel → CSV → Parquet → Analysis
- **No configuration needed**: Direct file paths for local files
- **Familiar SQL interface**: No need to learn new query language
- **Clear separation**: Local files vs remote databases
- **Automatic optimization**: Tools guide users to best practices

### Scalability
- Handle files from KB to GB
- Support for partitioned data (> 10GB)
- Streaming results for large queries
- Low memory footprint

---

## Testing Strategy

### Unit Tests
- Test each tool with various file formats
- Test error handling (missing files, invalid formats)
- Test edge cases (empty files, very large files)

### Integration Tests
- Test complete workflows (Excel → CSV → Parquet → Analysis)
- Test DuckDB datasource integration
- Test QuerySQLTool with local files

### Performance Tests
- Benchmark CSV vs Parquet query performance
- Test memory usage with large files
- Test conversion speed

---

## Documentation Updates

### User Documentation
- Add "Local File Analysis" guide
- Update QuerySQLTool documentation
- Add workflow examples

### Developer Documentation
- Tool implementation guide
- DuckDB integration guide
- Testing guide

---

## Migration Path

### For Existing Users
1. No breaking changes to existing tools
2. New tools are additive
3. Existing QuerySQLTool works as before
4. DuckDB datasource is optional

### Adoption Strategy
1. Release Phase 1 tools first
2. Gather user feedback
3. Iterate and improve
4. Release Phase 2/3 based on demand

---

## Future Enhancements

### Potential Features
- **Incremental updates**: Append data to existing Parquet files
- **Data validation**: Validate data quality during conversion
- **Schema evolution**: Handle schema changes in Parquet files
- **Remote file support**: Query files from S3, HTTP, etc.
- **Caching**: Cache query results for repeated queries
- **Visualization**: Generate charts from query results

---

## Summary

### Key Additions
1. **AnalyzeLocalFileTool** - Query local files with SQL (DuckDB internal)
2. **ConvertToParquetTool** - Optimize files for analysis
3. **ConvertExcelToCSVTool** - Handle Excel files

**Important:** DuckDB is used internally by tools, NOT exposed as a datasource type.

### Design Philosophy
- **Local files**: Temporary analysis, direct file paths, no configuration
- **Remote databases**: Persistent connections, datasource.yaml configuration
- **Clear separation**: Different tools for different use cases

### Decision Rules
- **< 100MB**: Use pandas, no conversion needed
- **> 100MB**: Convert to Parquet immediately
- **Excel**: Always convert to CSV first

### Expected Impact
- Enable efficient local file analysis
- Reduce query time by 50-100x
- Reduce file size by 5-10x
- No configuration overhead for temporary files

---

**Last Updated:** 2026-01-22
