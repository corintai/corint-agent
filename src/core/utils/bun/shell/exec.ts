import { logError } from '@utils/log'
import { createCancellableTextCollector } from './streams'
import { spawnWithExited } from './process'
import { getShellCmd } from './shellCmd'
import {
  buildSandboxCmd,
  isSandboxInitFailure,
  maybeAnnotateMacosSandboxStderr,
} from './sandbox'
import type { BunShellExecOptions, BunShellState, ExecResult } from './types'

export async function exec(
  state: BunShellState,
  command: string,
  abortSignal?: AbortSignal,
  timeout?: number,
  options?: BunShellExecOptions,
): Promise<ExecResult> {
  const DEFAULT_TIMEOUT = 120_000
  const commandTimeout = timeout ?? DEFAULT_TIMEOUT

  state.abortController = new AbortController()
  let wasAborted = false
  const onAbort = () => {
    wasAborted = true
    try {
      state.abortController?.abort()
    } catch {}
    try {
      state.currentProcess?.kill()
    } catch {}
  }

  if (abortSignal) {
    abortSignal.addEventListener('abort', onAbort, { once: true })
  }

  const sandbox = options?.sandbox
  const shouldAttemptSandbox = sandbox?.enabled === true
  const executionCwd =
    shouldAttemptSandbox && sandbox?.chdir ? sandbox.chdir : state.cwd

  const runOnce = async (
    cmd: string[],
    cwdOverride?: string,
  ): Promise<ExecResult> => {
    state.currentProcess = spawnWithExited({
      cmd,
      cwd: cwdOverride ?? executionCwd,
    })

    const stdoutCollector = createCancellableTextCollector(
      state.currentProcess.stdout,
      { onChunk: options?.onStdoutChunk },
    )
    const stderrCollector = createCancellableTextCollector(
      state.currentProcess.stderr,
      { onChunk: options?.onStderrChunk },
    )

    let timeoutHandle: ReturnType<typeof setTimeout> | null = null
    const timeoutPromise = new Promise<'timeout'>(resolve => {
      timeoutHandle = setTimeout(() => resolve('timeout'), commandTimeout)
    })

    const result = await Promise.race([
      state.currentProcess.exited.then(() => 'completed' as const),
      timeoutPromise,
    ])
    if (timeoutHandle) clearTimeout(timeoutHandle)

    if (result === 'timeout') {
      try {
        state.currentProcess.kill()
      } catch {}
      try {
        state.abortController.abort()
      } catch {}

      try {
        await state.currentProcess.exited
      } catch {}

      await Promise.race([
        Promise.allSettled([stdoutCollector.done, stderrCollector.done]),
        new Promise(resolve => setTimeout(resolve, 250)),
      ])
      await Promise.allSettled([
        stdoutCollector.cancel(),
        stderrCollector.cancel(),
      ])
      return {
        stdout: '',
        stderr: 'Command timed out',
        code: 143,
        interrupted: true,
      }
    }

    await Promise.race([
      Promise.allSettled([stdoutCollector.done, stderrCollector.done]),
      new Promise(resolve => setTimeout(resolve, 250)),
    ])
    await Promise.allSettled([
      stdoutCollector.cancel(),
      stderrCollector.cancel(),
    ])

    const stdout = stdoutCollector.getText()
    const stderr = stderrCollector.getText()
    const interrupted =
      wasAborted ||
      abortSignal?.aborted === true ||
      state.abortController?.signal.aborted === true
    const exitCode = state.currentProcess.exitCode ?? (interrupted ? 143 : 0)

    return {
      stdout,
      stderr,
      code: exitCode,
      interrupted,
    }
  }

  try {
    if (shouldAttemptSandbox) {
      const sandboxCmd = buildSandboxCmd(command, sandbox!, state.cwd)
      if (!sandboxCmd) {
        if (sandbox?.require) {
          return {
            stdout: '',
            stderr:
              'System sandbox is required but unavailable (missing bubblewrap or unsupported platform).',
            code: 2,
            interrupted: false,
          }
        }
        const fallback = await runOnce(getShellCmd(command))
        return {
          ...fallback,
          stderr:
            `[sandbox] unavailable, ran without isolation.\n${fallback.stderr}`.trim(),
        }
      }

      const sandboxed = await runOnce(sandboxCmd.cmd)
      sandboxed.stderr = maybeAnnotateMacosSandboxStderr(
        sandboxed.stderr,
        sandbox,
      )
      if (
        !sandboxed.interrupted &&
        sandboxed.code !== 0 &&
        isSandboxInitFailure(sandboxed.stderr) &&
        !sandbox?.require
      ) {
        const fallback = await runOnce(getShellCmd(command))
        return {
          ...fallback,
          stderr:
            `[sandbox] failed to start, ran without isolation.\n${fallback.stderr}`.trim(),
        }
      }

      return sandboxed
    }

    return await runOnce(getShellCmd(command))
  } catch (error) {
    if (state.abortController.signal.aborted) {
      state.currentProcess?.kill()
      return {
        stdout: '',
        stderr: 'Command was interrupted',
        code: 143,
        interrupted: true,
      }
    }

    const errorStr = error instanceof Error ? error.message : String(error)
    logError(`Shell execution error: ${errorStr}`)

    return {
      stdout: '',
      stderr: errorStr,
      code: 2,
      interrupted: false,
    }
  } finally {
    if (abortSignal) {
      abortSignal.removeEventListener('abort', onAbort)
    }
    state.currentProcess = null
    state.abortController = null
  }
}
