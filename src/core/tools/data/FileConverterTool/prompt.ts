export const PROMPT = `Convert files between different formats.

Supported operations:
1. **to_parquet**: Convert CSV/JSON/JSONL to Parquet (faster, smaller)
   - Use for files larger than 100MB
   - Use zstd compression for best size/performance
   - Enable cleanData to trim strings and remove null rows

2. **excel_to_csv**: Convert Excel (.xlsx/.xls) to CSV
   - Convert single sheet or all sheets
   - Specify sheetName or use first sheet by default

Examples:

FileConverter({
  operation: 'to_parquet',
  inputPath: '/data/sales.csv',
  outputPath: '/data/sales.parquet',
  compression: 'zstd',
  cleanData: true
})

FileConverter({
  operation: 'excel_to_csv',
  inputPath: '/data/report.xlsx',
  outputPath: '/data/report.csv',
  sheetName: 'Summary'
})

FileConverter({
  operation: 'excel_to_csv',
  inputPath: '/data/report.xlsx',
  convertAllSheets: true
})`
