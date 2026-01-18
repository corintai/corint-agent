import {
  appendTaskOutput,
  touchTaskOutputFile,
} from '@utils/log/taskOutputStore'
import { createCancellableTextCollector } from './streams'
import { spawnWithExited } from './process'
import { getShellCmd } from './shellCmd'
import { makeBackgroundTaskId } from './ids'
import {
  buildSandboxCmd,
  maybeAnnotateMacosSandboxStderr,
} from './sandbox'
import type {
  BackgroundProcess,
  BunShellExecOptions,
  BunShellPromotableExec,
  BunShellPromotableExecStatus,
  BunShellState,
  ExecResult,
} from './types'

export function execPromotable(
  state: BunShellState,
  command: string,
  abortSignal?: AbortSignal,
  timeout?: number,
  options?: BunShellExecOptions,
): BunShellPromotableExec {
  const DEFAULT_TIMEOUT = 120_000
  const commandTimeout = timeout ?? DEFAULT_TIMEOUT
  const startedAt = Date.now()

  const sandbox = options?.sandbox
  const shouldAttemptSandbox = sandbox?.enabled === true
  const executionCwd =
    shouldAttemptSandbox && sandbox?.chdir ? sandbox.chdir : state.cwd

  if (abortSignal?.aborted) {
    return {
      get status(): BunShellPromotableExecStatus {
        return 'killed'
      },
      background: () => null,
      kill: () => {},
      result: Promise.resolve({
        stdout: '',
        stderr: 'Command aborted before execution',
        code: 145,
        interrupted: true,
      }),
    }
  }

  const sandboxCmd = shouldAttemptSandbox
    ? buildSandboxCmd(command, sandbox!, state.cwd)
    : null
  if (shouldAttemptSandbox && sandbox?.require && !sandboxCmd) {
    return {
      get status(): BunShellPromotableExecStatus {
        return 'killed'
      },
      background: () => null,
      kill: () => {},
      result: Promise.resolve({
        stdout: '',
        stderr:
          'System sandbox is required but unavailable (missing bubblewrap or unsupported platform).',
        code: 2,
        interrupted: false,
      }),
    }
  }

  const cmdToRun = sandboxCmd ? sandboxCmd.cmd : getShellCmd(command)

  const internalAbortController = new AbortController()
  state.abortController = internalAbortController

  let status: BunShellPromotableExecStatus = 'running'
  let backgroundProcess: BackgroundProcess | null = null
  let backgroundTaskId: string | null = null
  let stdout = ''
  let stderr = ''
  let wasAborted = false
  let wasBackgrounded = false
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null
  let timedOut = false
  let onTimeoutCb:
    | ((background: (bashId?: string) => { bashId: string } | null) => void)
    | null = null

  const countNonEmptyLines = (chunk: string): number =>
    chunk.split('\n').filter(line => line.length > 0).length

  const spawnedProcess = spawnWithExited({ cmd: cmdToRun, cwd: executionCwd })
  state.currentProcess = spawnedProcess

  const onAbort = () => {
    if (status === 'backgrounded') return
    wasAborted = true
    try {
      internalAbortController.abort()
    } catch {}
    try {
      spawnedProcess.kill()
    } catch {}
    if (backgroundProcess) backgroundProcess.interrupted = true
  }

  const clearForegroundGuards = () => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle)
      timeoutHandle = null
    }
    if (abortSignal) {
      abortSignal.removeEventListener('abort', onAbort)
    }
  }

  if (abortSignal) {
    abortSignal.addEventListener('abort', onAbort, { once: true })
    if (abortSignal.aborted) onAbort()
  }

  const stdoutCollector = createCancellableTextCollector(
    spawnedProcess.stdout,
    {
      collectText: false,
      onChunk: chunk => {
        stdout += chunk
        options?.onStdoutChunk?.(chunk)
        if (backgroundProcess) {
          backgroundProcess.stdout = stdout
          appendTaskOutput(backgroundProcess.id, chunk)
          backgroundProcess.stdoutLineCount += countNonEmptyLines(chunk)
        }
      },
    },
  )
  const stderrCollector = createCancellableTextCollector(
    spawnedProcess.stderr,
    {
      collectText: false,
      onChunk: chunk => {
        stderr += chunk
        options?.onStderrChunk?.(chunk)
        if (backgroundProcess) {
          backgroundProcess.stderr = stderr
          appendTaskOutput(backgroundProcess.id, chunk)
          backgroundProcess.stderrLineCount += countNonEmptyLines(chunk)
        }
      },
    },
  )

  timeoutHandle = setTimeout(() => {
    if (status !== 'running') return
    if (onTimeoutCb) {
      onTimeoutCb(background)
      return
    }
    timedOut = true
    try {
      spawnedProcess.kill()
    } catch {}
    try {
      internalAbortController.abort()
    } catch {}
  }, commandTimeout)

  const background = (bashId?: string): { bashId: string } | null => {
    if (backgroundTaskId) return { bashId: backgroundTaskId }
    if (status !== 'running') return null

    backgroundTaskId = bashId ?? makeBackgroundTaskId()
    const outputFile = touchTaskOutputFile(backgroundTaskId)
    if (stdout) appendTaskOutput(backgroundTaskId, stdout)
    if (stderr) appendTaskOutput(backgroundTaskId, stderr)

    status = 'backgrounded'
    wasBackgrounded = true
    clearForegroundGuards()

    backgroundProcess = {
      id: backgroundTaskId,
      command,
      stdout,
      stderr,
      stdoutCursor: 0,
      stderrCursor: 0,
      stdoutLineCount: countNonEmptyLines(stdout),
      stderrLineCount: countNonEmptyLines(stderr),
      lastReportedStdoutLines: 0,
      lastReportedStderrLines: 0,
      code: null,
      interrupted: false,
      killed: false,
      timedOut: false,
      completionStatusSentInAttachment: false,
      notified: false,
      startedAt,
      timeoutAt: Number.POSITIVE_INFINITY,
      process: spawnedProcess,
      abortController: internalAbortController,
      timeoutHandle: null,
      cwd: executionCwd,
      outputFile,
    }

    state.backgroundProcesses.set(backgroundTaskId, backgroundProcess)

    state.currentProcess = null
    state.abortController = null

    return { bashId: backgroundTaskId }
  }

  const kill = () => {
    status = 'killed'
    try {
      spawnedProcess.kill()
    } catch {}
    try {
      internalAbortController.abort()
    } catch {}

    if (backgroundProcess) {
      backgroundProcess.interrupted = true
      backgroundProcess.killed = true
    }
  }

  const result = (async (): Promise<ExecResult> => {
    try {
      await spawnedProcess.exited

      if (status === 'running' || status === 'backgrounded')
        status = 'completed'

      if (backgroundProcess) {
        backgroundProcess.code = spawnedProcess.exitCode ?? 0
        backgroundProcess.interrupted =
          backgroundProcess.interrupted ||
          wasAborted ||
          internalAbortController.signal.aborted
      }

      if (!wasBackgrounded) {
        await Promise.race([
          Promise.allSettled([stdoutCollector.done, stderrCollector.done]),
          new Promise(resolve => setTimeout(resolve, 250)),
        ])
        await Promise.allSettled([
          stdoutCollector.cancel(),
          stderrCollector.cancel(),
        ])
      }

      const interrupted =
        wasAborted ||
        abortSignal?.aborted === true ||
        internalAbortController.signal.aborted === true ||
        timedOut

      let code = spawnedProcess.exitCode
      if (!Number.isFinite(code as any)) {
        code = interrupted ? 143 : 0
      }

      const stderrWithTimeout = timedOut
        ? [`Command timed out`, stderr].filter(Boolean).join('\n')
        : stderr
      const stderrAnnotated = sandboxCmd
        ? maybeAnnotateMacosSandboxStderr(stderrWithTimeout, sandbox)
        : stderrWithTimeout

      return {
        stdout,
        stderr: stderrAnnotated,
        code: code as number,
        interrupted,
      }
    } finally {
      clearForegroundGuards()

      if (state.currentProcess === spawnedProcess) {
        state.currentProcess = null
        state.abortController = null
      }
    }
  })()

  const execHandle: BunShellPromotableExec = {
    get status() {
      return status
    },
    background,
    kill,
    result,
  }

  execHandle.onTimeout = cb => {
    onTimeoutCb = cb
  }

  result
    .then(r => {
      if (!backgroundProcess || !backgroundTaskId) return
      backgroundProcess.code = r.code
      backgroundProcess.interrupted = r.interrupted
    })
    .catch(() => {
      if (!backgroundProcess) return
      backgroundProcess.code = backgroundProcess.code ?? 2
    })

  return execHandle
}
