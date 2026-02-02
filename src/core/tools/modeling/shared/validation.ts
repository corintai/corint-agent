export function validateDataSource(
  datasource?: string,
  filePath?: string,
): { valid: boolean; error?: string } {
  if (!datasource && !filePath) {
    return {
      valid: false,
      error: 'Must provide either datasource or filePath',
    }
  }
  return { valid: true }
}

export function validateBinaryTarget(target: number[]): {
  valid: boolean
  error?: string
} {
  const uniqueValues = [...new Set(target)]
  if (uniqueValues.length !== 2) {
    return {
      valid: false,
      error: `Target must be binary, found ${uniqueValues.length} unique values`,
    }
  }
  if (!uniqueValues.includes(0) || !uniqueValues.includes(1)) {
    return {
      valid: false,
      error: 'Target must contain only 0 and 1 values',
    }
  }
  return { valid: true }
}

export function validateBinCount(bins: number): {
  valid: boolean
  error?: string
} {
  if (bins < 2 || bins > 100) {
    return {
      valid: false,
      error: 'Number of bins must be between 2 and 100',
    }
  }
  return { valid: true }
}

export function isValidValue(value: any): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string' && value.trim() === '') return false
  if (typeof value === 'string' && ['null', 'N/A', 'NA', 'n/a'].includes(value))
    return false
  if (typeof value === 'number' && (isNaN(value) || !isFinite(value)))
    return false
  return true
}
