import { existsSync, mkdirSync } from 'fs'
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
let sessionWorkspaceRoot: string | null = null
let sessionOutputDir: string | null = null

export function setSessionWorkspaceRoot(root: string): void {
  sessionWorkspaceRoot = root
}

function getSessionWorkspaceRoot(): string {
  return sessionWorkspaceRoot ?? process.cwd()
}

export function getSessionOutputDir(): string {
  if (!sessionOutputDir) {
    sessionOutputDir = join(
      getSessionWorkspaceRoot(),
      '.corint',
      'workspace',
      SESSION_DIRNAME,
    )
  }
  return sessionOutputDir
}

export function ensureSessionOutputDirExists(): void {
  const outputDir = getSessionOutputDir()
  if (existsSync(outputDir)) return
  mkdirSync(outputDir, { recursive: true })
}
