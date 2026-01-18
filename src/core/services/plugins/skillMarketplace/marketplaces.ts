import { existsSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  KnownMarketplacesSchema,
  MarketplaceSource,
  MarketplaceSourceSchema,
  type KnownMarketplacesConfig,
  type MarketplaceManifest,
} from './schemas'
import { ensureDir, readJsonFile, writeJsonFile } from './fs'
import { parseMarketplaceSourceInput } from './sources'
import { marketplaceCacheBaseDir, knownMarketplacesConfigPath } from './paths'
import { readMarketplaceFromDirectory } from './manifest'
import { cacheMarketplaceToTempDir } from './sources'

export function loadKnownMarketplaces(): KnownMarketplacesConfig {
  const raw = readJsonFile<unknown>(knownMarketplacesConfigPath(), {})
  const parsed = KnownMarketplacesSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(
      `Marketplace configuration is corrupted: ${parsed.error.issues.map(i => i.message).join('; ')}`,
    )
  }
  return parsed.data
}

export function saveKnownMarketplaces(config: KnownMarketplacesConfig): void {
  const parsed = KnownMarketplacesSchema.safeParse(config)
  if (!parsed.success) {
    throw new Error(`Invalid marketplace config: ${parsed.error.message}`)
  }
  writeJsonFile(knownMarketplacesConfigPath(), parsed.data)
}

export function listMarketplaces(): KnownMarketplacesConfig {
  return loadKnownMarketplaces()
}

export async function addMarketplace(
  sourceInput: string,
): Promise<{ name: string }> {
  const source = parseMarketplaceSourceInput(sourceInput)
  const validatedSource = MarketplaceSourceSchema.safeParse(source)
  if (!validatedSource.success) {
    throw new Error(
      `Invalid marketplace source: ${validatedSource.error.issues.map(i => i.message).join('; ')}`,
    )
  }

  const config = loadKnownMarketplaces()
  const cacheBase = marketplaceCacheBaseDir()
  ensureDir(cacheBase)

  const tempDir = join(cacheBase, `tmp-${randomUUID()}`)
  try {
    await cacheMarketplaceToTempDir(validatedSource.data, tempDir)
    const manifest = readMarketplaceFromDirectory(tempDir)
    const marketplaceName = manifest.name

    if (config[marketplaceName]) {
      throw new Error(
        `Marketplace '${marketplaceName}' is already installed. Remove it first to re-add.`,
      )
    }

    const installLocation = join(cacheBase, marketplaceName)
    if (existsSync(installLocation)) {
      throw new Error(
        `Marketplace cache directory already exists: ${installLocation}`,
      )
    }

    renameSync(tempDir, installLocation)
    config[marketplaceName] = {
      source: validatedSource.data,
      installLocation,
      lastUpdated: new Date().toISOString(),
    }
    saveKnownMarketplaces(config)
    return { name: marketplaceName }
  } catch (error) {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true })
    throw error
  }
}

export function removeMarketplace(name: string): void {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Marketplace name is required')

  const config = loadKnownMarketplaces()
  const entry = config[trimmed]
  if (!entry) throw new Error(`Marketplace '${trimmed}' not found`)

  delete config[trimmed]
  saveKnownMarketplaces(config)

  try {
    if (existsSync(entry.installLocation)) {
      rmSync(entry.installLocation, { recursive: true, force: true })
    }
  } catch {}
}

export async function refreshMarketplaceAsync(name: string): Promise<void> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Marketplace name is required')

  const config = loadKnownMarketplaces()
  const entry = config[trimmed]
  if (!entry) throw new Error(`Marketplace '${trimmed}' not found`)

  const cacheBase = marketplaceCacheBaseDir()
  ensureDir(cacheBase)

  const tempDir = join(cacheBase, `tmp-${randomUUID()}`)
  try {
    await cacheMarketplaceToTempDir(entry.source as MarketplaceSource, tempDir)
    const manifest = readMarketplaceFromDirectory(tempDir)
    if (manifest.name !== trimmed) {
      throw new Error(
        `Marketplace name mismatch on refresh: expected ${trimmed}, got ${manifest.name}`,
      )
    }

    if (existsSync(entry.installLocation)) {
      rmSync(entry.installLocation, { recursive: true, force: true })
    }
    renameSync(tempDir, entry.installLocation)
    config[trimmed] = {
      ...entry,
      lastUpdated: new Date().toISOString(),
    }
    saveKnownMarketplaces(config)
  } catch (error) {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true })
    throw error
  }
}

export async function refreshAllMarketplacesAsync(
  onProgress?: (message: string) => void,
): Promise<{ refreshed: string[]; failed: { name: string; error: string }[] }> {
  const config = loadKnownMarketplaces()
  const names = Object.keys(config).sort()

  const refreshed: string[] = []
  const failed: { name: string; error: string }[] = []

  for (const name of names) {
    try {
      onProgress?.(`Updating marketplace: ${name}...`)
      await refreshMarketplaceAsync(name)
      refreshed.push(name)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failed.push({ name, error: message })
      onProgress?.(`Failed to refresh marketplace ${name}: ${message}`)
    }
  }

  return { refreshed, failed }
}

export function getMarketplaceManifest(marketplaceName: string): {
  manifest: MarketplaceManifest
  rootDir: string
  source: MarketplaceSource
} {
  const config = loadKnownMarketplaces()
  const entry = config[marketplaceName]
  if (!entry) {
    const available = Object.keys(config).sort().join(', ')
    throw new Error(
      `Marketplace '${marketplaceName}' not found. Available marketplaces: ${available || '(none)'}`,
    )
  }
  const manifest = readMarketplaceFromDirectory(entry.installLocation)
  return {
    manifest,
    rootDir: entry.installLocation,
    source: entry.source as MarketplaceSource,
  }
}
