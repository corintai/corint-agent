import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true })
}

export function readJsonFile<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback
    const raw = readFileSync(path, 'utf8')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function writeJsonFile(path: string, value: unknown): void {
  ensureDir(dirname(path))
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export function safeJoinWithin(baseDir: string, relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/')
  if (!normalized || normalized.startsWith('/') || normalized.includes('..')) {
    throw new Error(`Unsafe path in archive: ${relativePath}`)
  }
  const joined = resolve(baseDir, normalized.split('/').join(sep))
  const resolvedBase = resolve(baseDir)
  if (!joined.startsWith(resolvedBase + sep) && joined !== resolvedBase) {
    throw new Error(`Path traversal detected: ${relativePath}`)
  }
  return joined
}

export function ensureEmptyDir(path: string): void {
  if (existsSync(path)) rmSync(path, { recursive: true, force: true })
  ensureDir(path)
}

export function safeCopyDirectory(srcDir: string, destDir: string): void {
  ensureDir(destDir)
  const entries = readdirSync(srcDir, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = join(srcDir, entry.name)
    const destPath = join(destDir, entry.name)

    if (entry.isDirectory()) {
      safeCopyDirectory(srcPath, destPath)
      continue
    }

    if (entry.isFile()) {
      ensureDir(dirname(destPath))
      copyFileSync(srcPath, destPath)
      continue
    }
  }
}
