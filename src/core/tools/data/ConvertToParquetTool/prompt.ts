export const PROMPT = `Convert CSV, JSON, or JSONL files to Parquet using DuckDB.

Guidelines:
- Use for files larger than 100MB
- Parquet is faster and smaller than CSV/JSON
- Use zstd compression for best size/performance

Example:
ConvertToParquet({
  inputPath: '/data/sales.csv',
  outputPath: '/data/sales.parquet',
  compression: 'zstd'
})`
