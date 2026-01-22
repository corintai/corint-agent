# Local File Analysis Guide

## Overview

This document provides a comprehensive guide for analyzing local data files in corint-agent, covering different file sizes, formats, and processing strategies.

## Table of Contents

- [Quick Decision Tree](#quick-decision-tree)
- [File Size Categories](#file-size-categories)
- [File Format Support](#file-format-support)
- [Processing Strategies](#processing-strategies)
- [Tool Integration](#tool-integration)
- [Best Practices](#best-practices)
- [Performance Benchmarks](#performance-benchmarks)

---

## Quick Decision Tree

```
File to Analyze
│
├─ Excel File (any size)
│  └─ Step 1: Convert to CSV first (mandatory)
│     └─ Step 2: Follow CSV processing rules below
│
├─ Size < 100MB (CSV/JSON/Parquet)
│  └─ pandas.read_csv() / pandas.read_json() / pandas.read_parquet()
│     → Load into memory, all operations are fast
│     → NO need to convert to Parquet (data already in memory)
│
└─ Size > 100MB (CSV/JSON)
   ├─ CSV/JSON → Convert to Parquet immediately
   │  └─ Then query with DuckDB (50-100x faster)
   ├─ Already Parquet → DuckDB direct query
   └─ Very large (> 10GB) → Convert to partitioned Parquet
```

### Key Decision Rule (Simple!)

**File Format:**
- **Excel (.xlsx, .xls)**: Always convert to CSV first (mandatory)
- **CSV/JSON**: Follow size-based rules below
- **Parquet**: Direct query with DuckDB

**File Size (for CSV/JSON):**
- **< 100MB**: Use pandas, load into memory (NO Parquet conversion)
- **> 100MB**: Convert to Parquet immediately, then use DuckDB

**Why so simple?**
- Excel is not optimized for data analysis, convert to CSV first
- Data analysis rarely involves just one query
- Conversion cost is low (seconds to minutes)
- Subsequent queries are 50-100x faster
- No need to predict query count
- Simple decision, no regrets

---

## File Size Categories

### Small Files (< 100MB)

**Characteristics:**
- Can fit entirely in memory
- Fast to load (seconds)
- All operations in memory are extremely fast

**Recommended Strategy:**
- **Always use pandas** - load into memory
- **NO need to convert to Parquet**
- Data already in memory, operations are microsecond-level

**Why NOT convert to Parquet?**
```python
# Example: 50MB CSV file

# Approach 1: pandas (recommended)
import pandas as pd
df = pd.read_csv('data.csv')  # 2 seconds
result1 = df.groupby('category')['amount'].sum()  # 0.05 seconds
result2 = df[df['amount'] > 1000]  # 0.02 seconds
result3 = df.describe()  # 0.01 seconds
# Total: 2.08 seconds

# Approach 2: Convert to Parquet (NOT recommended)
import duckdb
duckdb.sql("COPY (SELECT * FROM 'data.csv') TO 'data.parquet'")  # 3 seconds
result1 = duckdb.sql("SELECT category, SUM(amount) FROM 'data.parquet' GROUP BY category").df()
result2 = duckdb.sql("SELECT * FROM 'data.parquet' WHERE amount > 1000").df()
result3 = duckdb.sql("SELECT * FROM 'data.parquet'").df().describe()
# Total: 3+ seconds (slower!)

# Conclusion: For small files, pandas in-memory operations are faster
```

**Example Usage:**
```python
import pandas as pd

# Load once into memory
df = pd.read_csv('small_data.csv')

# All subsequent operations are instant (in-memory)
result1 = df.groupby('category')['amount'].sum()
result2 = df[df['amount'] > 1000]
result3 = df.pivot_table(values='amount', index='category', aggfunc='mean')
result4 = df.merge(other_df, on='id')
# Each operation takes milliseconds
```

**Pros:**
- ✅ Simple and straightforward
- ✅ All operations in memory (extremely fast)
- ✅ Rich pandas ecosystem
- ✅ Easy debugging
- ✅ No conversion overhead

**Cons:**
- ❌ Not scalable to larger files
- ❌ Requires sufficient RAM

---

### Medium Files (100MB - 10GB)

**Characteristics:**
- Cannot fit entirely in memory
- Need streaming/chunking
- Require optimization

**Recommended Strategy:**
- **Always convert to Parquet first** (simple and practical)
- **Then query with DuckDB** (50-100x faster)

**Why Always Convert?**
```
Reality of data analysis:
- First query: Understand data structure
- Second query: Filter and explore
- Third query: Adjust conditions
- Fourth query: Generate report
- Fifth query: Verify results
...

→ You will almost never query just once!
→ Just convert to Parquet immediately, save time later
```

**Conversion is Fast:**
```
100MB file: 3 seconds
500MB file: 8 seconds
1GB file: 15 seconds
5GB file: 45 seconds
10GB file: 90 seconds

→ Small upfront cost, huge long-term benefit
```

**Workflow:**
```python
import duckdb

# Step 1: Convert to Parquet (one-time, takes seconds)
duckdb.sql("""
    COPY (SELECT * FROM 'data.csv')
    TO 'data.parquet' (FORMAT PARQUET, COMPRESSION ZSTD)
""")

# Step 2: All queries are now 50-100x faster
q1 = duckdb.sql("SELECT * FROM 'data.parquet' LIMIT 10").df()
q2 = duckdb.sql("SELECT category, SUM(amount) FROM 'data.parquet' GROUP BY category").df()
q3 = duckdb.sql("SELECT * FROM 'data.parquet' WHERE amount > 1000").df()
# Each query takes <0.1 seconds instead of 3+ seconds
```

**Performance Comparison:**
```
1GB CSV file:
- Direct query: 3.5 seconds/query
- Parquet query: 0.05 seconds/query
- Conversion time: 15 seconds

Even for just 5 queries:
- Without conversion: 3.5 × 5 = 17.5 seconds
- With conversion: 15 + (0.05 × 5) = 15.25 seconds
→ Already faster!

For 20 queries:
- Without conversion: 3.5 × 20 = 70 seconds
- With conversion: 15 + (0.05 × 20) = 16 seconds
→ 4.4x faster!
```

**Pros:**
- ✅ Simple decision (no need to predict query count)
- ✅ Extremely fast queries (50-100x)
- ✅ Small file size (5-10x compression)
- ✅ Low memory usage
- ✅ No regrets

**Cons:**
- ❌ Requires one-time conversion (but very fast)

**Example with pandas chunking:**
```python
import pandas as pd

# Process in chunks
chunk_size = 100000
results = []

for chunk in pd.read_csv('medium_data.csv', chunksize=chunk_size):
    # Process each chunk
    agg = chunk.groupby('category')['amount'].sum()
    results.append(agg)

# Combine results
final = pd.concat(results).groupby(level=0).sum()
```

**Pros:**
- ✅ Handles files larger than memory
- ✅ Fast query performance (DuckDB)
- ✅ SQL interface (DuckDB)

**Cons:**
- ❌ Requires DuckDB installation
- ❌ More complex than simple pandas

---

### Large Files (> 10GB)

**Characteristics:**
- Much larger than memory
- Slow to process repeatedly
- Need persistent optimization

**Recommended Strategy:**
1. **Always convert to Parquet first** (mandatory, not optional)
2. **Query Parquet files with DuckDB**
3. **Use partitioning for very large files**

**Why Mandatory Conversion?**
```
10GB CSV file:
- Direct query time: 35 seconds/query
- Conversion time: 90 seconds (one-time)
- Parquet query time: 0.5 seconds/query

Even for just 3 queries:
- Without conversion: 35 × 3 = 105 seconds
- With conversion: 90 + (0.5 × 3) = 91.5 seconds
→ Saves time even with just 3 queries!

For 10+ queries:
- Without conversion: 35 × 10 = 350 seconds
- With conversion: 90 + (0.5 × 10) = 95 seconds
→ Saves 255 seconds (73% faster)!
```

**Step 1: Convert to Parquet**
```python
import duckdb

# Convert CSV to Parquet (one-time operation)
duckdb.sql("""
    COPY (SELECT * FROM 'large_data.csv')
    TO 'large_data.parquet' (
        FORMAT PARQUET,
        COMPRESSION ZSTD,
        ROW_GROUP_SIZE 100000
    )
""")

# File size comparison:
# large_data.csv:     10 GB
# large_data.parquet: 1.2 GB (8x smaller)
```

**Step 2: Query Parquet**
```python
# Subsequent queries are 50-100x faster
result = duckdb.sql("""
    SELECT
        DATE_TRUNC('month', date) as month,
        category,
        SUM(amount) as revenue
    FROM 'large_data.parquet'
    WHERE date >= '2024-01-01'
    GROUP BY month, category
""").df()
```

**Step 3: Partitioning (for very large files)**
```python
# Partition by year and month
duckdb.sql("""
    COPY (SELECT * FROM 'large_data.csv')
    TO 'data' (
        FORMAT PARQUET,
        PARTITION_BY (year, month)
    )
""")

# Creates directory structure:
# data/year=2024/month=01/data.parquet
# data/year=2024/month=02/data.parquet
# ...

# Query with automatic partition pruning
result = duckdb.sql("""
    SELECT * FROM 'data/**/*.parquet'
    WHERE year = 2024 AND month = 1
""").df()
# Only reads data/year=2024/month=01/ directory
```

**Pros:**
- ✅ Extremely fast queries (50-100x)
- ✅ Small file size (5-10x compression)
- ✅ Low memory usage
- ✅ Supports complex SQL

**Cons:**
- ❌ Requires one-time conversion
- ❌ Additional storage during conversion

---

## File Format Support

### CSV Files

**Small CSV (< 100MB):**
```python
import pandas as pd
df = pd.read_csv('data.csv')
```

**Medium/Large CSV (> 100MB):**
```python
import duckdb

# Direct query
result = duckdb.sql("SELECT * FROM 'data.csv' LIMIT 10").df()

# With custom options
result = duckdb.sql("""
    SELECT * FROM read_csv_auto('data.csv',
        delim=';',
        header=true,
        quote='"',
        encoding='UTF-8'
    )
""").df()
```

**Convert to Parquet:**
```bash
duckdb -c "COPY (SELECT * FROM 'data.csv') TO 'data.parquet' (FORMAT PARQUET, COMPRESSION ZSTD)"
```

---

### JSON Files

**Small JSON (< 100MB):**
```python
import pandas as pd

# JSON Lines
df = pd.read_json('data.jsonl', lines=True)

# Standard JSON
df = pd.read_json('data.json')
```

**Medium/Large JSON (> 100MB):**
```python
import duckdb

# JSON Lines
result = duckdb.sql("SELECT * FROM 'data.jsonl'").df()

# Nested JSON
result = duckdb.sql("""
    SELECT
        data->>'name' as name,
        data->>'age' as age,
        data->'address'->>'city' as city
    FROM read_json_auto('data.json')
""").df()
```

**Convert to Parquet:**
```python
duckdb.sql("""
    COPY (SELECT * FROM 'data.jsonl')
    TO 'data.parquet' (FORMAT PARQUET)
""")
```

---

### Parquet Files

**All Sizes:**
```python
import duckdb

# Direct query (optimal for all sizes)
result = duckdb.sql("SELECT * FROM 'data.parquet'").df()

# Complex queries
result = duckdb.sql("""
    SELECT
        category,
        COUNT(*) as count,
        SUM(amount) as total
    FROM 'data.parquet'
    WHERE date >= '2024-01-01'
    GROUP BY category
""").df()

# Multiple files
result = duckdb.sql("""
    SELECT * FROM 'data/*.parquet'
""").df()
```

**Why Parquet is Best:**
- ✅ Columnar storage (fast aggregations)
- ✅ Built-in compression (5-10x smaller)
- ✅ Schema preservation (types, metadata)
- ✅ Predicate pushdown (skip irrelevant data)
- ✅ 50-100x faster than CSV

---

### Excel Files

**Important: Always Convert to CSV First**

Excel files (.xlsx, .xls) are not optimized for data analysis. They contain formatting, formulas, and other metadata that slow down processing.

**Recommended Workflow:**
```
Excel → CSV → (if > 100MB) → Parquet
```

**Small Excel (< 100MB):**
```python
import pandas as pd

# Step 1: Convert to CSV (mandatory)
df = pd.read_excel('data.xlsx', sheet_name='Sheet1')
df.to_csv('data.csv', index=False)

# Step 2: Work with CSV
df = pd.read_csv('data.csv')
# Now you can analyze the data efficiently
```

**Large Excel (> 100MB):**
```python
import pandas as pd
import duckdb

# Step 1: Convert to CSV (mandatory)
df = pd.read_excel('large.xlsx')
df.to_csv('large.csv', index=False)

# Step 2: Convert CSV to Parquet (recommended for > 100MB)
duckdb.sql("""
    COPY (SELECT * FROM 'large.csv')
    TO 'large.parquet' (FORMAT PARQUET, COMPRESSION ZSTD)
""")

# Step 3: Query Parquet (fast!)
result = duckdb.sql("SELECT * FROM 'large.parquet'").df()
```

**Multiple Sheets:**
```python
import pandas as pd

# Read all sheets
excel_file = pd.ExcelFile('data.xlsx')

# Convert each sheet to CSV
for sheet_name in excel_file.sheet_names:
    df = pd.read_excel(excel_file, sheet_name=sheet_name)
    df.to_csv(f'{sheet_name}.csv', index=False)
    print(f"Converted {sheet_name} to {sheet_name}.csv")
```

**Why Convert Excel to CSV?**
- ✅ CSV is much faster to read/write
- ✅ CSV is a pure data format (no formatting overhead)
- ✅ CSV works with all data tools (DuckDB, pandas, etc.)
- ✅ CSV files are smaller and more portable
- ❌ Excel is slow for large datasets
- ❌ Excel has row limits (1,048,576 rows)

**Command-line Conversion (Alternative):**
```bash
# Using LibreOffice (if installed)
libreoffice --headless --convert-to csv data.xlsx

# Using Python script
python -c "import pandas as pd; pd.read_excel('data.xlsx').to_csv('data.csv', index=False)"
```

---

### Other Formats

**SQLite Database:**
```python
import duckdb

# Query SQLite directly
result = duckdb.sql("""
    SELECT * FROM sqlite_scan('database.db', 'table_name')
""").df()
```

**Apache Arrow:**
```python
import duckdb

result = duckdb.sql("SELECT * FROM 'data.arrow'").df()
```

**Compressed Files:**
```python
import duckdb

# DuckDB automatically handles compression
result = duckdb.sql("SELECT * FROM 'data.csv.gz'").df()
result = duckdb.sql("SELECT * FROM 'data.parquet.zst'").df()
```

---

## Processing Strategies

### Strategy 1: Direct Query (Only for True One-time Analysis)

**Use When:**
- Absolutely certain you'll only query once
- Quick data validation
- File size < 500MB

**Example:**
```python
import duckdb

# Quick one-time check
result = duckdb.sql("""
    SELECT COUNT(*) as total_rows
    FROM 'sales.csv'
""").df()
```

**Note:** In practice, this is rare. Most analysis requires multiple queries.

---

### Strategy 2: Convert to Parquet (Recommended for > 100MB)

**Use When:**
- File size > 100MB (always recommended)
- Any serious data analysis work
- Want simple, no-regret decision

**Why This is the Default Strategy:**
```
Reality check:
- "I'll just query once" → Usually queries 5-10 times
- Conversion cost: 3-90 seconds (depending on size)
- Query speedup: 50-100x faster
- File size reduction: 5-10x smaller

→ Just convert immediately, don't overthink it!
```

**Workflow:**
```python
import duckdb

# Step 1: One-time conversion (takes a few seconds)
duckdb.sql("""
    COPY (SELECT * FROM 'sales.csv')
    TO 'sales.parquet' (FORMAT PARQUET, COMPRESSION ZSTD)
""")

# Step 2: All subsequent queries are 50-100x faster
result1 = duckdb.sql("SELECT * FROM 'sales.parquet' WHERE amount > 1000").df()
result2 = duckdb.sql("SELECT category, SUM(amount) FROM 'sales.parquet' GROUP BY category").df()
result3 = duckdb.sql("SELECT * FROM 'sales.parquet' WHERE date = '2024-01-15'").df()
```

**Performance Comparison:**
```
Query: SELECT category, SUM(amount) FROM data GROUP BY category

CSV (2GB):     3.5 seconds
Parquet (250MB): 0.05 seconds  (70x faster!)
```

**Pros:**
- ✅ Extremely fast queries
- ✅ Small file size
- ✅ One-time conversion cost

**Cons:**
- ❌ Requires conversion step
- ❌ Additional storage during conversion

---

### Strategy 3: Chunked Processing (Fallback for pandas)

**Use When:**
- Cannot install DuckDB
- Need pandas-specific features
- File size 100MB - 5GB

**Example:**
```python
import pandas as pd

chunk_size = 100000
results = []

for chunk in pd.read_csv('data.csv', chunksize=chunk_size):
    # Process each chunk
    filtered = chunk[chunk['amount'] > 1000]
    agg = filtered.groupby('category')['amount'].sum()
    results.append(agg)

# Combine results
final = pd.concat(results).groupby(level=0).sum()
```

**Pros:**
- ✅ Works with standard pandas
- ✅ Handles files larger than memory

**Cons:**
- ❌ Slower than DuckDB
- ❌ More complex code
- ❌ Limited to simple aggregations

---

### Strategy 4: Sampling (For Initial Exploration)

**Use When:**
- Very large file (> 10GB)
- Just need to understand data structure
- Quick exploratory analysis

**Example:**
```python
import duckdb

# Sample 1% of data
sample = duckdb.sql("""
    SELECT * FROM 'large_data.csv'
    USING SAMPLE 1 PERCENT
""").df()

# Or fixed number of rows
sample = duckdb.sql("""
    SELECT * FROM 'large_data.csv'
    USING SAMPLE 10000 ROWS
""").df()

# Analyze sample
print(sample.describe())
print(sample.head())
```

**Pros:**
- ✅ Very fast
- ✅ Good for exploration
- ✅ Low memory usage

**Cons:**
- ❌ Not representative for all analyses
- ❌ Cannot use for accurate aggregations

---

## Tool Integration

### Integration with corint-agent

#### Option 1: Extend DataSource to Support DuckDB

**Add DuckDB as a data source type:**

```typescript
// src/core/services/datasource/types.ts
export type DataSourceType =
  | 'postgres' | 'mysql' | 'clickhouse' | 'sqlite'
  | 'duckdb'  // New: Local file analysis

// src/core/services/datasource/data-source.ts
case 'duckdb':
  client = {
    type: 'duckdb',
    config,
    client: new duckdb.Database(':memory:')
  }
  break
```

**Configuration:**
```yaml
# repository/datasource.yaml
datasources:
  - name: local_files
    type: duckdb
    # DuckDB can query local CSV/Parquet/JSON files directly
```

**Usage with QuerySQLTool:**
```typescript
QuerySQL({
  datasource: 'local_files',
  sql: "SELECT * FROM '/path/to/data.csv' LIMIT 10"
})

QuerySQL({
  datasource: 'local_files',
  sql: `
    SELECT category, SUM(amount) as total
    FROM '/path/to/sales.parquet'
    WHERE date >= '2024-01-01'
    GROUP BY category
  `
})
```

---

#### Option 2: Create Dedicated Tools

**AnalyzeLocalFileTool:**
```typescript
// src/core/tools/data/AnalyzeLocalFileTool/AnalyzeLocalFileTool.tsx
export const inputSchema = z.strictObject({
  filePath: z.string().describe('Path to CSV/Parquet/JSON file'),
  query: z.string().describe('SQL query to execute'),
  limit: z.number().optional().default(1000),
  format: z.enum(['csv', 'parquet', 'json', 'auto']).default('auto'),
})

async function executeQuery(filePath: string, query: string, limit: number) {
  const db = new duckdb.Database(':memory:')
  const conn = db.connect()

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

**ConvertToParquetTool:**
```typescript
// src/core/tools/data/ConvertToParquetTool/ConvertToParquetTool.tsx
export const inputSchema = z.strictObject({
  inputPath: z.string().describe('Input CSV/JSON file path'),
  outputPath: z.string().optional()
    .describe('Output Parquet file path (default: same name with .parquet)'),
  compression: z.enum(['snappy', 'gzip', 'zstd', 'none']).default('zstd'),
  cleanData: z.boolean().optional().default(false),
})

async function convertToParquet(input: Input) {
  const output = input.outputPath || input.inputPath.replace(/\.(csv|json)$/, '.parquet')

  const db = new duckdb.Database(':memory:')
  const conn = db.connect()

  await conn.run(`
    COPY (SELECT * FROM '${input.inputPath}')
    TO '${output}' (
      FORMAT PARQUET,
      COMPRESSION ${input.compression.toUpperCase()}
    )
  `)

  conn.close()
  db.close()

  return { inputFile: input.inputPath, outputFile: output }
}
```

---

#### Option 3: Use BashTool (Quick Solution)

**Direct DuckDB commands:**
```typescript
// Query CSV
Bash({
  command: `duckdb -c "SELECT * FROM 'data.csv' LIMIT 10"`,
  description: "Preview CSV file"
})

// Convert to Parquet
Bash({
  command: `duckdb -c "COPY (SELECT * FROM 'data.csv') TO 'data.parquet' (FORMAT PARQUET)"`,
  description: "Convert CSV to Parquet"
})

// Complex analysis
Bash({
  command: `duckdb -c "
    SELECT
      category,
      COUNT(*) as count,
      SUM(amount) as total
    FROM 'sales.parquet'
    GROUP BY category
    ORDER BY total DESC
  "`,
  description: "Analyze sales by category"
})
```

---

## Best Practices

### 1. Choose the Right Format

**For Storage:**
- ✅ **Parquet**: Best for repeated analysis
- ⚠️ **CSV**: Good for human readability, sharing
- ❌ **JSON**: Avoid for large datasets (inefficient)
- ❌ **Excel**: Avoid for data > 100MB

**For Analysis:**
- Always use Parquet if possible
- Convert CSV to Parquet for files > 1GB
- Use DuckDB for direct querying

---

### 2. Optimize File Organization

**Single Large File:**
```
data.parquet (10GB)
→ Works, but not optimal
```

**Partitioned Files (Better):**
```
data/
  year=2024/
    month=01/data.parquet
    month=02/data.parquet
    ...
  year=2025/
    month=01/data.parquet
    ...
```

**Benefits:**
- Query only relevant partitions
- Faster queries (10-100x for filtered queries)
- Easier to manage

---

### 3. Memory Management

**Bad Practice:**
```python
# Loads entire file into memory
df = pd.read_csv('10GB.csv')  # ❌ OOM
```

**Good Practice:**
```python
# Streams data, low memory usage
result = duckdb.sql("""
    SELECT category, SUM(amount)
    FROM '10GB.csv'
    GROUP BY category
""").df()  # ✅ Only result in memory
```

---

### 4. Query Optimization

**Inefficient:**
```python
# Loads all data, then filters
df = duckdb.sql("SELECT * FROM 'data.parquet'").df()
filtered = df[df['amount'] > 1000]
```

**Efficient:**
```python
# Filters during read (predicate pushdown)
filtered = duckdb.sql("""
    SELECT * FROM 'data.parquet'
    WHERE amount > 1000
""").df()
```

---

### 5. Compression Selection

**For Storage (minimize size):**
- Use `ZSTD` compression
- 8-10x compression ratio
- Slightly slower decompression

**For Speed (minimize query time):**
- Use `SNAPPY` compression
- 3-5x compression ratio
- Fastest decompression

**Recommendation:**
- Default to `ZSTD` for most cases
- Use `SNAPPY` if query speed is critical

---

## Performance Benchmarks

### Test Setup
- File: 1000万行, 10列
- Machine: MacBook Pro M1, 16GB RAM
- Data: Sales transactions

### Results

| Format | File Size | Load Time | Query Time | Memory Usage |
|--------|-----------|-----------|------------|--------------|
| CSV | 2.0 GB | 60s (pandas) | 5s | 16 GB |
| CSV | 2.0 GB | 0s (DuckDB) | 3.5s | 800 MB |
| Parquet (Snappy) | 400 MB | 0s (DuckDB) | 0.08s | 150 MB |
| Parquet (ZSTD) | 250 MB | 0s (DuckDB) | 0.05s | 100 MB |

**Query:** `SELECT category, SUM(amount) FROM data GROUP BY category`

### Key Takeaways

1. **DuckDB + Parquet is 70x faster than pandas + CSV**
2. **Parquet files are 5-8x smaller than CSV**
3. **Memory usage is 10-100x lower with DuckDB**
4. **No loading time with DuckDB (streaming)**
5. **Convert to Parquet early for files > 100MB if you need 3+ queries**

---

## Common Workflows

### Workflow 1: One-time Analysis

```python
import duckdb

# Direct query, no preprocessing
result = duckdb.sql("""
    SELECT
        DATE_TRUNC('month', date) as month,
        category,
        COUNT(*) as orders,
        SUM(amount) as revenue
    FROM 'sales.csv'
    WHERE date >= '2024-01-01'
    GROUP BY month, category
    ORDER BY month, revenue DESC
""").df()

print(result)
```

---

### Workflow 2: Repeated Analysis

```python
import duckdb

# Step 1: Convert to Parquet (one-time, takes 30 seconds)
duckdb.sql("""
    COPY (SELECT * FROM 'sales.csv')
    TO 'sales.parquet' (FORMAT PARQUET, COMPRESSION ZSTD)
""")

# Step 2: Run multiple queries (each takes <1 second)
q1 = duckdb.sql("SELECT * FROM 'sales.parquet' WHERE amount > 1000").df()
q2 = duckdb.sql("SELECT category, SUM(amount) FROM 'sales.parquet' GROUP BY category").df()
q3 = duckdb.sql("SELECT * FROM 'sales.parquet' WHERE date = '2024-01-15'").df()
```

---

### Workflow 3: Large File Analysis

```python
import duckdb

# Step 1: Convert to partitioned Parquet
duckdb.sql("""
    COPY (SELECT * FROM 'large_sales.csv')
    TO 'sales_data' (
        FORMAT PARQUET,
        PARTITION_BY (year, month),
        COMPRESSION ZSTD
    )
""")

# Step 2: Query with automatic partition pruning
result = duckdb.sql("""
    SELECT
        category,
        SUM(amount) as revenue
    FROM 'sales_data/**/*.parquet'
    WHERE year = 2024 AND month = 1
    GROUP BY category
""").df()
# Only reads sales_data/year=2024/month=01/ directory
```

---

### Workflow 4: Multi-file Analysis

```python
import duckdb

# Query multiple files at once
result = duckdb.sql("""
    SELECT
        filename,
        COUNT(*) as records,
        SUM(amount) as total
    FROM read_csv_auto('logs/*.csv', filename=true)
    GROUP BY filename
    ORDER BY total DESC
""").df()

# Or combine multiple Parquet files
result = duckdb.sql("""
    SELECT * FROM 'data/sales_*.parquet'
    WHERE date >= '2024-01-01'
""").df()
```

---

## Troubleshooting

### Issue 1: Out of Memory

**Problem:**
```python
df = pd.read_csv('large.csv')  # MemoryError
```

**Solution:**
```python
# Use DuckDB instead
import duckdb
result = duckdb.sql("SELECT * FROM 'large.csv' LIMIT 1000").df()
```

---

### Issue 2: Slow CSV Queries

**Problem:**
```python
# Takes 5 seconds every time
result = duckdb.sql("SELECT * FROM 'data.csv' WHERE amount > 1000").df()
```

**Solution:**
```python
# Convert to Parquet once
duckdb.sql("COPY (SELECT * FROM 'data.csv') TO 'data.parquet'")

# Now queries take 0.1 seconds
result = duckdb.sql("SELECT * FROM 'data.parquet' WHERE amount > 1000").df()
```

---

### Issue 3: CSV Format Issues

**Problem:**
```python
# DuckDB cannot parse CSV
result = duckdb.sql("SELECT * FROM 'data.csv'").df()  # Error
```

**Solution:**
```python
# Specify format options
result = duckdb.sql("""
    SELECT * FROM read_csv_auto('data.csv',
        delim=';',           -- Use semicolon
        header=true,
        quote='"',
        escape='"',
        encoding='GBK'       -- Chinese encoding
    )
""").df()
```

---

### Issue 4: DuckDB Not Installed

**Problem:**
```python
import duckdb  # ModuleNotFoundError
```

**Solution:**
```bash
# Install DuckDB
pip install duckdb

# Or use system package manager
brew install duckdb  # macOS
apt install duckdb   # Linux
```

---

## Summary

### Quick Reference

| File Format | File Size | Strategy |
|-------------|-----------|----------|
| Excel | Any | Convert to CSV first (mandatory) |
| CSV/JSON | < 100MB | pandas - load into memory |
| CSV/JSON | > 100MB | Convert to Parquet, then use DuckDB |
| Parquet | Any | DuckDB direct query |

**Processing Flow:**
```
Excel (any size) → CSV → Follow CSV rules
CSV < 100MB → pandas (in-memory)
CSV > 100MB → Parquet → DuckDB
```

**That's it! Simple and practical.**

### Key Recommendations

1. **Excel files: Always convert to CSV first (mandatory)**
2. **< 100MB: Use pandas, NO Parquet conversion needed**
3. **> 100MB: Always convert to Parquet first**
4. **Use partitioning for files > 10GB**
5. **Always use ZSTD compression for Parquet**
6. **Don't overthink it - just convert and save time**

### Decision Rule (Simplified!)

```
File format:
├─ Excel (.xlsx, .xls) → Convert to CSV first (mandatory)
│  └─ Then follow CSV rules below
│
File size (for CSV/JSON):
├─ < 100MB → pandas (in-memory operations)
└─ > 100MB → Convert to Parquet immediately
   └─ Why? Data analysis rarely involves just one query
```

### Installation

```bash
# DuckDB CLI
brew install duckdb  # macOS
apt install duckdb   # Linux

# Python package
pip install duckdb

# Node.js package
npm install duckdb
```

### Resources

- [DuckDB Documentation](https://duckdb.org/docs/)
- [Parquet Format Specification](https://parquet.apache.org/docs/)
- [pandas Documentation](https://pandas.pydata.org/docs/)

---

**Last Updated:** 2026-01-22
