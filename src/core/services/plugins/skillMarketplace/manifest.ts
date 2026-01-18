import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { MarketplaceManifestSchema } from './schemas'

export function readMarketplaceFromDirectory(rootDir: string) {
  const primaryMarketplaceFile = resolve(
    rootDir,
    '.corint-plugin',
    'marketplace.json',
  )
  const legacyMarketplaceFile = resolve(
    rootDir,
    '.claude-plugin',
    'marketplace.json',
  )
  const marketplaceFile = existsSync(primaryMarketplaceFile)
    ? primaryMarketplaceFile
    : legacyMarketplaceFile
  if (!existsSync(marketplaceFile)) {
    throw new Error(
      `Marketplace file not found (expected .corint-plugin/marketplace.json or .claude-plugin/marketplace.json)`,
    )
  }
  const raw = readFileSync(marketplaceFile, 'utf8')
  const parsed = MarketplaceManifestSchema.safeParse(JSON.parse(raw))
  if (!parsed.success) {
    throw new Error(
      `Invalid marketplace.json: ${parsed.error.issues.map(i => i.message).join('; ')}`,
    )
  }
  return parsed.data
}
