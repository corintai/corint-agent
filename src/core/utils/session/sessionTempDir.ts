import { existsSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function formatSessionTimestamp(date: Date): string {
  const year = date.getFullYear()
  const month = pad2(date.getMonth() + 1)
  const day = pad2(date.getDate())
  const hours = pad2(date.getHours())
  const minutes = pad2(date.getMinutes())
  const seconds = pad2(date.getSeconds())
  return `${year}${month}${day}_${hours}${minutes}${seconds}`
}

const SESSION_DIRNAME = `session_${formatSessionTimestamp(new Date())}`
let sessionOutputDir: string | null = null
let sessionTempDir: string | null = null

function getSessionBaseDir(): string {
  if (process.platform === 'win32') {
    return join(tmpdir(), '.corint')
  }
  return join('/tmp', '.corint')
}

export function getSessionOutputDir(): string {
  if (!sessionOutputDir) {
    sessionOutputDir = join(getSessionBaseDir(), SESSION_DIRNAME)
  }
  return sessionOutputDir
}

export function ensureSessionOutputDirExists(): void {
  const outputDir = getSessionOutputDir()
  if (existsSync(outputDir)) return
  mkdirSync(outputDir, { recursive: true })
}

export function getSessionTempDir(): string {
  if (!sessionTempDir) {
    sessionTempDir = join(getSessionOutputDir(), 'tmp')
  }
  return sessionTempDir
}

export function ensureSessionTempDirExists(): void {
  ensureSessionOutputDirExists()
  const tempDir = getSessionTempDir()
  if (existsSync(tempDir)) return
  mkdirSync(tempDir, { recursive: true })
}
