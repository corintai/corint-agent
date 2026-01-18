export const isDebugMode = () =>
  process.argv.includes('--debug-verbose') ||
  process.argv.includes('--mcp-debug') ||
  process.argv.some(
    arg => arg === '--debug' || arg === '-d' || arg.startsWith('--debug='),
  )

export const isVerboseMode = () => process.argv.includes('--verbose')

export const isDebugVerboseMode = () => process.argv.includes('--debug-verbose')
