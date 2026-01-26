export const PROMPT = `Convert Excel files to CSV.

Guidelines:
- Use for .xlsx or .xls files
- Convert all sheets when needed
- Follow CSV rules for further analysis

Example:
ConvertExcelToCSV({
  inputPath: '/data/report.xlsx',
  outputPath: '/data/report.csv'
})`
