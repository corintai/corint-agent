import type { ChildProcess } from 'child_process'

export type ShellChildProcess = ChildProcess & { exited: Promise<void> }

export type ExecResult = {
  stdout: string
  stderr: string
  code: number
  interrupted: boolean
}

export type BunShellPromotableExecStatus =
  | 'running'
  | 'backgrounded'
  | 'completed'
  | 'killed'

export type BunShellPromotableExec = {
  get status(): BunShellPromotableExecStatus
  background: (bashId?: string) => { bashId: string } | null
  kill: () => void
  result: Promise<ExecResult>
  onTimeout?: (
    cb: (background: (bashId?: string) => { bashId: string } | null) => void,
  ) => void
}

export type BunShellSandboxReadConfig = {
  denyOnly: string[]
}

export type BunShellSandboxWriteConfig = {
  allowOnly: string[]
  denyWithinAllow?: string[]
}

export type BunShellSandboxOptions = {
  enabled: boolean
  require?: boolean
  needsNetworkRestriction?: boolean
  allowNetwork?: boolean

  allowUnixSockets?: string[]
  allowAllUnixSockets?: boolean
  allowLocalBinding?: boolean
  httpProxyPort?: number
  socksProxyPort?: number

  readConfig?: BunShellSandboxReadConfig
  writeConfig?: BunShellSandboxWriteConfig
  enableWeakerNestedSandbox?: boolean
  binShell?: string

  writableRoots?: string[]
  chdir?: string

  __platformOverride?: NodeJS.Platform
  __bwrapPathOverride?: string | null
  __sandboxExecPathOverride?: string | null
}

export type BunShellExecOptions = {
  sandbox?: BunShellSandboxOptions
  onStdoutChunk?: (chunk: string) => void
  onStderrChunk?: (chunk: string) => void
}

export type BackgroundShellStatusAttachment = {
  type: 'task_progress'
  taskId: string
  stdoutLineDelta: number
  stderrLineDelta: number
  outputFile: string
}

export type BashNotification = {
  type: 'bash_notification'
  taskId: string
  description: string
  status: 'completed' | 'failed' | 'killed'
  exitCode?: number
  outputFile: string
}

export type BackgroundProcess = {
  id: string
  command: string
  stdout: string
  stderr: string
  stdoutCursor: number
  stderrCursor: number
  stdoutLineCount: number
  stderrLineCount: number
  lastReportedStdoutLines: number
  lastReportedStderrLines: number
  code: number | null
  interrupted: boolean
  killed: boolean
  timedOut: boolean
  completionStatusSentInAttachment: boolean
  notified: boolean
  startedAt: number
  timeoutAt: number
  process: ShellChildProcess
  abortController: AbortController
  timeoutHandle: ReturnType<typeof setTimeout> | null
  cwd: string
  outputFile: string
}

export type BunShellState = {
  cwd: string
  currentProcess: ShellChildProcess | null
  abortController: AbortController | null
  backgroundProcesses: Map<string, BackgroundProcess>
}

export function createShellState(cwd: string): BunShellState {
  return {
    cwd,
    currentProcess: null,
    abortController: null,
    backgroundProcesses: new Map(),
  }
}
