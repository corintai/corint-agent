import { existsSync } from 'fs'
import { isAbsolute, resolve } from 'path'
import { execPromotable } from './execPromotable'
import { exec } from './exec'
import {
  execInBackground,
  flushBackgroundShellStatusAttachments,
  flushBashNotifications,
  getBackgroundOutput,
  killBackgroundShell,
  listBackgroundShells,
  readBackgroundOutput,
} from './background'
import { getShellCmdForPlatform } from './shellCmd'
import { createShellState } from './types'
import type {
  BackgroundProcess,
  BackgroundShellStatusAttachment,
  BashNotification,
  BunShellExecOptions,
  BunShellPromotableExec,
  BunShellState,
  ExecResult,
} from './types'

export class BunShell {
  private state: BunShellState
  private isAlive: boolean = true
  private static instance: BunShell | null = null

  constructor(cwd: string) {
    this.state = createShellState(cwd)
  }

  static restart() {
    if (BunShell.instance) {
      BunShell.instance.close()
      BunShell.instance = null
    }
  }

  static getInstance(): BunShell {
    if (!BunShell.instance || !BunShell.instance.isAlive) {
      BunShell.instance = new BunShell(process.cwd())
    }
    return BunShell.instance
  }

  static getShellCmdForPlatform(
    platform: NodeJS.Platform,
    command: string,
    env: NodeJS.ProcessEnv = process.env,
  ): string[] {
    return getShellCmdForPlatform(platform, command, env)
  }

  execPromotable(
    command: string,
    abortSignal?: AbortSignal,
    timeout?: number,
    options?: BunShellExecOptions,
  ): BunShellPromotableExec {
    return execPromotable(this.state, command, abortSignal, timeout, options)
  }

  async exec(
    command: string,
    abortSignal?: AbortSignal,
    timeout?: number,
    options?: BunShellExecOptions,
  ): Promise<ExecResult> {
    return exec(this.state, command, abortSignal, timeout, options)
  }

  execInBackground(
    command: string,
    timeout?: number,
    options?: BunShellExecOptions,
  ): { bashId: string } {
    return execInBackground(this.state, command, timeout, options)
  }

  getBackgroundOutput(shellId: string): {
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
    return getBackgroundOutput(this.state, shellId)
  }

  readBackgroundOutput(
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
    return readBackgroundOutput(this.state, bashId, options)
  }

  killBackgroundShell(shellId: string): boolean {
    return killBackgroundShell(this.state, shellId)
  }

  listBackgroundShells(): BackgroundProcess[] {
    return listBackgroundShells(this.state)
  }

  pwd(): string {
    return this.state.cwd
  }

  async setCwd(cwd: string) {
    const resolved = isAbsolute(cwd) ? cwd : resolve(this.state.cwd, cwd)
    if (!existsSync(resolved)) {
      throw new Error(`Path "${resolved}" does not exist`)
    }
    this.state.cwd = resolved
  }

  killChildren() {
    this.state.abortController?.abort()
    this.state.currentProcess?.kill()
    for (const bg of Array.from(this.state.backgroundProcesses.keys())) {
      this.killBackgroundShell(bg)
    }
  }

  close(): void {
    this.isAlive = false
    this.killChildren()
  }

  flushBashNotifications(): BashNotification[] {
    return flushBashNotifications(this.state)
  }

  flushBackgroundShellStatusAttachments(): BackgroundShellStatusAttachment[] {
    return flushBackgroundShellStatusAttachments(this.state)
  }
}
