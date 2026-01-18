import {
  appendTaskOutput,
  getTaskOutputFilePath,
  touchTaskOutputFile,
} from '@utils/log/taskOutputStore'
import { startStreamReader } from './streams'
import { spawnWithExited } from './process'
import { getShellCmd } from './shellCmd'
import { makeBackgroundTaskId } from './ids'
import { buildSandboxCmd, maybeAnnotateMacosSandboxStderr } from './sandbox'
import type {
  BackgroundProcess,
  BackgroundShellStatusAttachment,
  BashNotification,
  BunShellExecOptions,
  BunShellState,
} from './types'

export function renderBackgroundShellStatusAttachment(
  attachment: BackgroundShellStatusAttachment,
): string {
  const parts: string[] = []
  if (attachment.stdoutLineDelta > 0) {
    const n = attachment.stdoutLineDelta
    parts.push(`${n} line${n > 1 ? 's' : ''} of stdout`)
  }
  if (attachment.stderrLineDelta > 0) {
    const n = attachment.stderrLineDelta
    parts.push(`${n} line${n > 1 ? 's' : ''} of stderr`)
  }
  if (parts.length === 0) return ''
  return `Background bash ${attachment.taskId} has new output: ${parts.join(', ')}. Read ${attachment.outputFile} to see output.`
}

export function renderBashNotification(notification: BashNotification): string {
  const status = notification.status
  const exitCode = notification.exitCode

  const summarySuffix =
    status === 'completed'
      ? `completed${exitCode !== undefined ? ` (exit code ${exitCode})` : ''}`
      : status === 'failed'
        ? `failed${exitCode !== undefined ? ` with exit code ${exitCode}` : ''}`
        : 'was killed'

  return [
    '<bash-notification>',
    `<shell-id>${notification.taskId}</shell-id>`,
    `<output-file>${notification.outputFile}</output-file>`,
    `<status>${status}</status>`,
    `<summary>Background command "${notification.description}" ${summarySuffix}.</summary>`,
    'Read the output file to retrieve the output.',
    '</bash-notification>',
  ].join('\n')
}

export function execInBackground(
  state: BunShellState,
  command: string,
  timeout?: number,
  options?: BunShellExecOptions,
): { bashId: string } {
  const DEFAULT_TIMEOUT = 120_000
  const commandTimeout = timeout ?? DEFAULT_TIMEOUT
  const abortController = new AbortController()

  const sandbox = options?.sandbox
  const sandboxCmd =
    sandbox?.enabled === true
      ? buildSandboxCmd(command, sandbox, state.cwd)
      : null
  const executionCwd =
    sandbox?.enabled === true && sandbox?.chdir ? sandbox.chdir : state.cwd

  if (sandbox?.enabled === true && sandbox?.require && !sandboxCmd) {
    throw new Error(
      'System sandbox is required but unavailable (missing bubblewrap or unsupported platform).',
    )
  }

  const cmdToRun = sandboxCmd ? sandboxCmd.cmd : getShellCmd(command)

  const bashId = makeBackgroundTaskId()
  const outputFile = touchTaskOutputFile(bashId)

  const process = spawnWithExited({ cmd: cmdToRun, cwd: executionCwd })
  const timeoutHandle = setTimeout(() => {
    abortController.abort()
    backgroundProcess.timedOut = true
    process.kill()
  }, commandTimeout)

  const backgroundProcess: BackgroundProcess = {
    id: bashId,
    command,
    stdout: '',
    stderr: '',
    stdoutCursor: 0,
    stderrCursor: 0,
    stdoutLineCount: 0,
    stderrLineCount: 0,
    lastReportedStdoutLines: 0,
    lastReportedStderrLines: 0,
    code: null,
    interrupted: false,
    killed: false,
    timedOut: false,
    completionStatusSentInAttachment: false,
    notified: false,
    startedAt: Date.now(),
    timeoutAt: Date.now() + commandTimeout,
    process,
    abortController,
    timeoutHandle,
    cwd: executionCwd,
    outputFile,
  }

  const countNonEmptyLines = (chunk: string): number =>
    chunk.split('\n').filter(line => line.length > 0).length

  startStreamReader(process.stdout, chunk => {
    backgroundProcess.stdout += chunk
    appendTaskOutput(bashId, chunk)
    backgroundProcess.stdoutLineCount += countNonEmptyLines(chunk)
  })
  startStreamReader(process.stderr, chunk => {
    backgroundProcess.stderr += chunk
    appendTaskOutput(bashId, chunk)
    backgroundProcess.stderrLineCount += countNonEmptyLines(chunk)
  })

  process.exited.then(() => {
    backgroundProcess.code = process.exitCode ?? 0
    backgroundProcess.interrupted =
      backgroundProcess.interrupted || abortController.signal.aborted
    if (sandbox?.enabled === true) {
      backgroundProcess.stderr = maybeAnnotateMacosSandboxStderr(
        backgroundProcess.stderr,
        sandbox,
      )
    }
    if (backgroundProcess.timeoutHandle) {
      clearTimeout(backgroundProcess.timeoutHandle)
      backgroundProcess.timeoutHandle = null
    }
  })

  state.backgroundProcesses.set(bashId, backgroundProcess)
  return { bashId }
}

export function getBackgroundOutput(
  state: BunShellState,
  shellId: string,
): {
  stdout: string
  stderr: string
  code: number | null
  interrupted: boolean
  killed: boolean
  timedOut: boolean
  running: boolean
  command: string
  cwd: string
  startedAt: number
  timeoutAt: number
  outputFile: string
} | null {
  const proc = state.backgroundProcesses.get(shellId)
  if (!proc) return null
  const running = proc.code === null && !proc.interrupted
  return {
    stdout: proc.stdout,
    stderr: proc.stderr,
    code: proc.code,
    interrupted: proc.interrupted,
    killed: proc.killed,
    timedOut: proc.timedOut,
    running,
    command: proc.command,
    cwd: proc.cwd,
    startedAt: proc.startedAt,
    timeoutAt: proc.timeoutAt,
    outputFile: proc.outputFile,
  }
}

export function readBackgroundOutput(
  state: BunShellState,
  bashId: string,
  options?: { filter?: string },
): {
  shellId: string
  command: string
  cwd: string
  startedAt: number
  timeoutAt: number
  status: 'running' | 'completed' | 'failed' | 'killed'
  exitCode: number | null
  stdout: string
  stderr: string
  stdoutLines: number
  stderrLines: number
  filterPattern?: string
} | null {
  const proc = state.backgroundProcesses.get(bashId)
  if (!proc) return null

  const stdoutDelta = proc.stdout.slice(proc.stdoutCursor)
  const stderrDelta = proc.stderr.slice(proc.stderrCursor)

  proc.stdoutCursor = proc.stdout.length
  proc.stderrCursor = proc.stderr.length

  const stdoutLines = stdoutDelta === '' ? 0 : stdoutDelta.split('\n').length
  const stderrLines = stderrDelta === '' ? 0 : stderrDelta.split('\n').length

  let stdoutToReturn = stdoutDelta
  let stderrToReturn = stderrDelta

  const filter = options?.filter?.trim()
  if (filter) {
    const regex = new RegExp(filter, 'i')
    stdoutToReturn = stdoutDelta
      .split('\n')
      .filter(line => regex.test(line))
      .join('\n')
    stderrToReturn = stderrDelta
      .split('\n')
      .filter(line => regex.test(line))
      .join('\n')
  }

  const status: 'running' | 'completed' | 'failed' | 'killed' = proc.killed
    ? 'killed'
    : proc.code === null
      ? 'running'
      : proc.code === 0
        ? 'completed'
        : 'failed'

  return {
    shellId: bashId,
    command: proc.command,
    cwd: proc.cwd,
    startedAt: proc.startedAt,
    timeoutAt: proc.timeoutAt,
    status,
    exitCode: proc.code,
    stdout: stdoutToReturn,
    stderr: stderrToReturn,
    stdoutLines,
    stderrLines,
    ...(filter ? { filterPattern: filter } : {}),
  }
}

export function killBackgroundShell(
  state: BunShellState,
  shellId: string,
): boolean {
  const proc = state.backgroundProcesses.get(shellId)
  if (!proc) return false
  try {
    proc.interrupted = true
    proc.killed = true
    proc.abortController.abort()
    proc.process.kill()
    if (proc.timeoutHandle) {
      clearTimeout(proc.timeoutHandle)
      proc.timeoutHandle = null
    }
    return true
  } catch {
    return false
  }
}

export function listBackgroundShells(state: BunShellState): BackgroundProcess[] {
  return Array.from(state.backgroundProcesses.values())
}

export function flushBashNotifications(
  state: BunShellState,
): BashNotification[] {
  const processes = Array.from(state.backgroundProcesses.values())

  const statusFor = (
    proc: BackgroundProcess,
  ): 'running' | 'completed' | 'failed' | 'killed' =>
    proc.killed
      ? 'killed'
      : proc.code === null
        ? 'running'
        : proc.code === 0
          ? 'completed'
          : 'failed'

  const notifications: BashNotification[] = []

  for (const proc of processes) {
    if (proc.notified) continue
    const status = statusFor(proc)
    if (status === 'running') continue

    notifications.push({
      type: 'bash_notification',
      taskId: proc.id,
      description: proc.command,
      outputFile: proc.outputFile || getTaskOutputFilePath(proc.id),
      status,
      ...(proc.code !== null ? { exitCode: proc.code } : {}),
    })

    proc.notified = true
  }

  return notifications
}

export function flushBackgroundShellStatusAttachments(
  state: BunShellState,
): BackgroundShellStatusAttachment[] {
  const processes = Array.from(state.backgroundProcesses.values())

  const statusFor = (
    proc: BackgroundProcess,
  ): 'running' | 'completed' | 'failed' | 'killed' =>
    proc.killed
      ? 'killed'
      : proc.code === null
        ? 'running'
        : proc.code === 0
          ? 'completed'
          : 'failed'

  const progressAttachments: BackgroundShellStatusAttachment[] = []

  for (const proc of processes) {
    if (statusFor(proc) !== 'running') continue

    const stdoutDelta = proc.stdoutLineCount - proc.lastReportedStdoutLines
    const stderrDelta = proc.stderrLineCount - proc.lastReportedStderrLines
    if (stdoutDelta === 0 && stderrDelta === 0) continue

    proc.lastReportedStdoutLines = proc.stdoutLineCount
    proc.lastReportedStderrLines = proc.stderrLineCount

    progressAttachments.push({
      type: 'task_progress',
      taskId: proc.id,
      stdoutLineDelta: stdoutDelta,
      stderrLineDelta: stderrDelta,
      outputFile: proc.outputFile || getTaskOutputFilePath(proc.id),
    })
  }

  return progressAttachments
}
