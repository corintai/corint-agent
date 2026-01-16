import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  ensureSessionTempDirExists,
  getSessionTempDir,
} from '@utils/session/sessionTempDir'

const SCREENSHOT_FILENAME = 'kode_cli_latest_screenshot.png'

function getScreenshotPath(): string {
  return join(getSessionTempDir(), SCREENSHOT_FILENAME)
}

export const CLIPBOARD_ERROR_MESSAGE =
  'No image found in clipboard. Use Cmd + Ctrl + Shift + 4 to copy a screenshot to clipboard.'

export function getImageFromClipboard(): string | null {
  if (process.platform !== 'darwin') {
    return null
  }

  try {
    ensureSessionTempDirExists()
    const screenshotPath = getScreenshotPath()
    execSync(`osascript -e 'the clipboard as «class PNGf»'`, {
      stdio: 'ignore',
    })

    execSync(
      `osascript -e 'set png_data to (the clipboard as «class PNGf»)' -e 'set fp to open for access POSIX file "${screenshotPath}" with write permission' -e 'write png_data to fp' -e 'close access fp'`,
      { stdio: 'ignore' },
    )

    const imageBuffer = readFileSync(screenshotPath)
    const base64Image = imageBuffer.toString('base64')

    execSync(`rm -f "${screenshotPath}"`, { stdio: 'ignore' })

    return base64Image
  } catch {
    return null
  }
}
