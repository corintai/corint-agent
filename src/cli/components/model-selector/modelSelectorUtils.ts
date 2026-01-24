import { providers } from '@constants/models'

export function getProviderLabel(provider: string, modelCount: number): string {
  if (providers[provider]) {
    return `${providers[provider].name} ${providers[provider].status === 'wip' ? '(WIP)' : ''}`
  }
  return `${provider}`
}

export function clampIndex(index: number, length: number): number {
  return length === 0 ? 0 : Math.max(0, Math.min(index, length - 1))
}

export function getSafeVisibleOptionCount(
  terminalRows: number,
  requestedCount: number,
  optionLength: number,
  reservedLines: number = 10,
): number {
  const available = Math.max(1, terminalRows - reservedLines)
  return Math.max(1, Math.min(requestedCount, optionLength, available))
}

export function formatApiKeyDisplay(key: string): string {
  if (!key) return ''
  if (key.length <= 10) return '*'.repeat(key.length)

  const prefix = key.slice(0, 4)
  const suffix = key.slice(-4)
  const middleLength = Math.max(0, key.length - 8)
  const middle = '*'.repeat(Math.min(middleLength, 30))

  return `${prefix}${middle}${suffix}`
}
