import { copyFileSync, existsSync, lstatSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { unzipSync } from 'fflate'
import type { MarketplaceSource } from './schemas'
import { MarketplaceSourceSchema } from './schemas'
import {
  ensureDir,
  ensureEmptyDir,
  safeCopyDirectory,
  safeJoinWithin,
} from './fs'

function githubRepoFromUrl(input: string): string | null {
  const ssh = input.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/)
  if (ssh?.[1]) return ssh[1]
  const https = input.match(
    /^https?:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/,
  )
  if (https?.[1]) return https[1]
  return null
}

function parseRefAndPath(input: string): {
  base: string
  ref?: string
  path?: string
} {
  const [beforeHash, hashPart] = input.split('#', 2)
  const [base, refPart] = beforeHash.split('@', 2)
  return {
    base,
    ref: refPart?.trim() || undefined,
    path: hashPart?.trim() || undefined,
  }
}

function normalizeMarketplaceSubPath(path: string | undefined): string | null {
  if (!path) return null
  const trimmed = path
    .trim()
    .replace(/^\.?\//, '')
    .replace(/^\/+/, '')
  if (!trimmed) return null
  if (trimmed.includes('..')) {
    throw new Error(`Marketplace path contains '..': ${path}`)
  }
  return trimmed.replace(/\\/g, '/').replace(/\/+$/, '')
}

export function parseMarketplaceSourceInput(
  sourceInput: string,
): MarketplaceSource {
  const raw = sourceInput.trim()
  if (!raw) throw new Error('Marketplace source is required')

  for (const prefix of [
    'github:',
    'git:',
    'url:',
    'npm:',
    'file:',
    'dir:',
  ] as const) {
    if (raw.startsWith(prefix)) {
      const rest = raw.slice(prefix.length).trim()
      const parsed = parseRefAndPath(rest)
      if (prefix === 'github:') {
        return {
          source: 'github',
          repo: parsed.base.trim(),
          ...(parsed.ref ? { ref: parsed.ref } : {}),
          ...(parsed.path ? { path: parsed.path } : {}),
        }
      }
      if (prefix === 'git:') {
        const repo = githubRepoFromUrl(parsed.base.trim())
        if (repo) {
          return {
            source: 'github',
            repo,
            ...(parsed.ref ? { ref: parsed.ref } : {}),
            ...(parsed.path ? { path: parsed.path } : {}),
          }
        }
        return {
          source: 'git',
          url: parsed.base.trim(),
          ...(parsed.ref ? { ref: parsed.ref } : {}),
          ...(parsed.path ? { path: parsed.path } : {}),
        }
      }
      if (prefix === 'url:') {
        return { source: 'url', url: rest }
      }
      if (prefix === 'npm:') {
        return { source: 'npm', package: rest }
      }
      if (prefix === 'file:') {
        return { source: 'file', path: rest }
      }
      if (prefix === 'dir:') {
        return { source: 'directory', path: rest }
      }
    }
  }

  const resolved = resolve(raw)
  if (existsSync(resolved)) {
    const stat = lstatSync(resolved)
    if (stat.isDirectory()) return { source: 'directory', path: resolved }
    if (stat.isFile()) return { source: 'file', path: resolved }
    throw new Error(`Marketplace source must be a directory or file: ${raw}`)
  }

  const parsed = parseRefAndPath(raw)
  if (/^[^/\s]+\/[^/\s]+$/.test(parsed.base)) {
    return {
      source: 'github',
      repo: parsed.base,
      ...(parsed.ref ? { ref: parsed.ref } : {}),
      ...(parsed.path ? { path: parsed.path } : {}),
    }
  }

  const repo = githubRepoFromUrl(parsed.base)
  if (repo) {
    return {
      source: 'github',
      repo,
      ...(parsed.ref ? { ref: parsed.ref } : {}),
      ...(parsed.path ? { path: parsed.path } : {}),
    }
  }

  if (/^https?:\/\//.test(raw)) {
    return { source: 'url', url: raw }
  }

  throw new Error(
    `Unsupported marketplace source: ${sourceInput}. Use a local path, "owner/repo", or prefixes like github:, git:, url:, file:, dir:.`,
  )
}

async function fetchBinary(url: string): Promise<Uint8Array> {
  const resp = await fetch(url, { method: 'GET' })
  if (!resp.ok) {
    throw new Error(
      `Failed to download ${url}: ${resp.status} ${resp.statusText}`,
    )
  }
  const buf = await resp.arrayBuffer()
  return new Uint8Array(buf)
}

async function tryDownloadGithubZip(
  repo: string,
  ref: string,
): Promise<Uint8Array> {
  const [owner, name] = repo.split('/', 2)
  if (!owner || !name) throw new Error(`Invalid GitHub repo: ${repo}`)

  const candidates = ref.startsWith('refs/')
    ? [ref]
    : [`refs/heads/${ref}`, `refs/tags/${ref}`]

  let lastError: Error | null = null
  for (const candidate of candidates) {
    const url = `https://codeload.github.com/${owner}/${name}/zip/${candidate}`
    try {
      return await fetchBinary(url)
    } catch (err) {
      lastError = err instanceof Error ? err : Error(String(err))
    }
  }
  throw lastError ?? new Error(`Failed to download GitHub repo ${repo}@${ref}`)
}

export async function cacheMarketplaceToTempDir(
  source: MarketplaceSource,
  tempDir: string,
): Promise<void> {
  ensureEmptyDir(tempDir)

  if (source.source === 'directory') {
    const root = resolve(source.path)
    if (!existsSync(root) || !lstatSync(root).isDirectory()) {
      throw new Error(`Directory not found: ${source.path}`)
    }
    safeCopyDirectory(root, tempDir)
    return
  }

  if (source.source === 'file') {
    const file = resolve(source.path)
    if (!existsSync(file) || !lstatSync(file).isFile()) {
      throw new Error(`File not found: ${source.path}`)
    }
    const out = join(tempDir, '.corint-plugin')
    ensureDir(out)
    copyFileSync(file, join(out, 'marketplace.json'))
    return
  }

  if (source.source === 'github') {
    const pathWithin = normalizeMarketplaceSubPath(source.path)

    const preferredRef = source.ref?.trim() || ''
    const refsToTry = preferredRef ? [preferredRef] : ['main', 'master']

    let zip: Uint8Array | null = null
    let usedRef = preferredRef || 'main'
    let lastError: Error | null = null
    for (const ref of refsToTry) {
      try {
        zip = await tryDownloadGithubZip(source.repo, ref)
        usedRef = ref
        break
      } catch (err) {
        lastError = err instanceof Error ? err : Error(String(err))
      }
    }
    if (!zip)
      throw (
        lastError ?? new Error(`Failed to download GitHub repo ${source.repo}`)
      )

    const files = unzipSync(zip)
    const names = Object.keys(files).filter(Boolean)
    const topDir = names.length > 0 ? names[0]!.split('/')[0]! : ''
    const includePrefix = pathWithin
      ? `${topDir}/${pathWithin.replace(/\/+$/, '')}/`
      : `${topDir}/`

    let extractedCount = 0
    for (const [name, data] of Object.entries(files)) {
      if (!name.startsWith(includePrefix)) continue
      const rel = name.slice(includePrefix.length)
      if (!rel) continue
      if (rel.endsWith('/')) {
        ensureDir(safeJoinWithin(tempDir, rel))
        continue
      }
      const dest = safeJoinWithin(tempDir, rel)
      ensureDir(dirname(dest))
      writeFileSync(dest, data)
      extractedCount++
    }

    if (extractedCount === 0) {
      throw new Error(
        `No files extracted from ${source.repo}@${usedRef}${pathWithin ? `#${pathWithin}` : ''}`,
      )
    }
    return
  }

  if (source.source === 'url') {
    const url = source.url
    if (url.toLowerCase().endsWith('.json')) {
      const data = await fetchBinary(url)
      const out = join(tempDir, '.corint-plugin')
      ensureDir(out)
      writeFileSync(join(out, 'marketplace.json'), Buffer.from(data))
      return
    }
    if (url.toLowerCase().endsWith('.zip')) {
      const zip = await fetchBinary(url)
      const files = unzipSync(zip)
      for (const [name, data] of Object.entries(files)) {
        if (!name || name.endsWith('/')) continue
        const dest = safeJoinWithin(tempDir, name)
        ensureDir(dirname(dest))
        writeFileSync(dest, data)
      }
      return
    }
    throw new Error(
      `Unsupported url marketplace source. Provide a .json or .zip URL: ${url}`,
    )
  }

  if (source.source === 'git') {
    const repo = githubRepoFromUrl(source.url)
    if (repo) {
      await cacheMarketplaceToTempDir(
        {
          source: 'github',
          repo,
          ...(source.ref ? { ref: source.ref } : {}),
          ...(source.path ? { path: source.path } : {}),
        },
        tempDir,
      )
      return
    }
    throw new Error(
      `git sources are not supported without GitHub conversion (url=${source.url})`,
    )
  }

  if (source.source === 'npm') {
    throw new Error(
      `npm marketplace sources are not supported yet (package=${source.package}). Install the package and add it as a local dir instead.`,
    )
  }
}

export function validateMarketplaceSource(source: MarketplaceSource): void {
  const validatedSource = MarketplaceSourceSchema.safeParse(source)
  if (!validatedSource.success) {
    throw new Error(
      `Invalid marketplace source: ${validatedSource.error.issues.map(i => i.message).join('; ')}`,
    )
  }
}
