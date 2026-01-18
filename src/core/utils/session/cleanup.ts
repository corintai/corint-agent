import { promises as fs } from 'fs'
import { join } from 'path'
import { logError, CACHE_PATHS } from '@utils/log'
import { existsSync, statSync } from 'fs'

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export type CleanupResult = {
  messages: number
  errors: number
  sessions?: number
}

export function convertFileNameToDate(filename: string): Date {
  const isoStr = filename
    .split('.')[0]!
    .replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/, 'T$1:$2:$3.$4Z')
  return new Date(isoStr)
}

export async function cleanupOldMessageFiles(): Promise<CleanupResult> {
  const messagePath = CACHE_PATHS.messages()
  const errorPath = CACHE_PATHS.errors()
  const thirtyDaysAgo = new Date(Date.now() - THIRTY_DAYS_MS)
  const deletedCounts: CleanupResult = { messages: 0, errors: 0 }

  for (const path of [messagePath, errorPath]) {
    try {
      const files = await fs.readdir(path)

      for (const file of files) {
        try {
          const timestamp = convertFileNameToDate(file)
          if (timestamp < thirtyDaysAgo) {
            await fs.unlink(join(path, file))
            if (path === messagePath) {
              deletedCounts.messages++
            } else {
              deletedCounts.errors++
            }
          }
        } catch (error: unknown) {
          logError(
            `Failed to process file ${file}: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code !== 'ENOENT'
      ) {
        logError(
          `Failed to cleanup directory ${path}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  }

  return deletedCounts
}

export function cleanupOldMessageFilesInBackground(): void {
  const immediate = setImmediate(cleanupOldMessageFiles)
  immediate.unref()
}

export async function cleanupOldSessionDirs(): Promise<number> {
  const baseDir =
    process.platform === 'win32'
      ? join(require('os').tmpdir(), 'corint')
      : join('/tmp', 'corint')

  if (!existsSync(baseDir)) return 0

  const sevenDaysAgo = new Date(Date.now() - SEVEN_DAYS_MS)
  let deletedCount = 0

  try {
    const entries = await fs.readdir(baseDir)

    for (const entry of entries) {
      if (!entry.startsWith('session_')) continue

      try {
        const sessionPath = join(baseDir, entry)
        const stat = statSync(sessionPath)

        if (stat.isDirectory() && stat.mtime < sevenDaysAgo) {
          await fs.rm(sessionPath, { recursive: true, force: true })
          deletedCount++
        }
      } catch (error: unknown) {
        logError(
          `Failed to cleanup session ${entry}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      'code' in error &&
      error.code !== 'ENOENT'
    ) {
      logError(
        `Failed to cleanup sessions directory: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  return deletedCount
}

export function cleanupOldSessionDirsInBackground(): void {
  const immediate = setImmediate(cleanupOldSessionDirs)
  immediate.unref()
}
