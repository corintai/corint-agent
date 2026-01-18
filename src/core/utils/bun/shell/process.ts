import { spawn } from 'child_process'
import type { ShellChildProcess } from './types'
import which from 'which'
import {
  ensureSessionTempDirExists,
  getSessionTempDir,
} from '@utils/session/sessionTempDir'

export function whichSync(bin: string): string | null {
  try {
    return which.sync(bin, { nothrow: true }) ?? null
  } catch {
    return null
  }
}

export function whichOrSelf(bin: string): string {
  return whichSync(bin) ?? bin
}

export function spawnWithExited(options: {
  cmd: string[]
  cwd: string
  env?: NodeJS.ProcessEnv
}): ShellChildProcess {
  ensureSessionTempDirExists()
  const mergedEnv = {
    ...(options.env ?? process.env),
    TMPDIR: getSessionTempDir(),
  }
  const child = spawn(options.cmd[0], options.cmd.slice(1), {
    cwd: options.cwd,
    env: mergedEnv,
    stdio: ['inherit', 'pipe', 'pipe'],
    windowsHide: true,
  }) as ShellChildProcess

  child.exited = new Promise(resolve => {
    const done = () => resolve()
    child.once('exit', done)
    child.once('error', done)
  })

  return child
}
