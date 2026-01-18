import { spawn } from 'child_process'

function buildShellCommand(command: string): string[] {
  if (process.platform === 'win32') {
    return ['cmd.exe', '/d', '/s', '/c', command]
  }
  return ['/bin/sh', '-c', command]
}

export async function runCommandHook(args: {
  command: string
  stdinJson: unknown
  cwd: string
  env?: Record<string, string>
  signal?: AbortSignal
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const cmd = buildShellCommand(args.command)
  const proc = spawn(cmd[0], cmd.slice(1), {
    cwd: args.cwd,
    env: { ...(process.env as any), ...(args.env ?? {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })

  let wasAborted = false
  const onAbort = () => {
    wasAborted = true
    try {
      proc.kill()
    } catch {}
  }
  if (args.signal) {
    if (args.signal.aborted) onAbort()
    args.signal.addEventListener('abort', onAbort, { once: true })
  }

  try {
    const input = JSON.stringify(args.stdinJson)
    try {
      proc.stdin?.write(input)
      proc.stdin?.end()
    } catch {}

    let stdout = ''
    let stderr = ''

    const collect = (
      stream: NodeJS.ReadableStream | null,
      append: (chunk: string) => void,
    ): { done: Promise<void>; cleanup: () => void } => {
      if (!stream) {
        return { done: Promise.resolve(), cleanup: () => {} }
      }
      try {
        ;(stream as any).setEncoding?.('utf8')
      } catch {}

      let resolveDone: (() => void) | null = null
      const done = new Promise<void>(resolve => {
        resolveDone = resolve
      })

      const finish = () => {
        cleanup()
        if (!resolveDone) return
        resolveDone()
        resolveDone = null
      }

      const onData = (chunk: unknown) => {
        append(
          typeof chunk === 'string'
            ? chunk
            : Buffer.isBuffer(chunk)
              ? chunk.toString('utf8')
              : String(chunk),
        )
      }

      const onError = () => finish()

      const cleanup = () => {
        stream.off('data', onData)
        stream.off('end', finish)
        stream.off('close', finish)
        stream.off('error', onError)
      }

      stream.on('data', onData)
      stream.once('end', finish)
      stream.once('close', finish)
      stream.once('error', onError)

      return { done, cleanup }
    }

    const stdoutCollector = collect(proc.stdout, chunk => {
      stdout += chunk
    })
    const stderrCollector = collect(proc.stderr, chunk => {
      stderr += chunk
    })

    const exitCode = await new Promise<number>(resolve => {
      proc.once('exit', (code, signal) => {
        if (typeof code === 'number') return resolve(code)
        if (signal) return resolve(143)
        return resolve(0)
      })
      proc.once('error', () => resolve(1))
    })

    await Promise.race([
      Promise.allSettled([stdoutCollector.done, stderrCollector.done]),
      new Promise(resolve => setTimeout(resolve, 250)),
    ])
    stdoutCollector.cleanup()
    stderrCollector.cleanup()

    return {
      exitCode: wasAborted && exitCode === 0 ? 143 : exitCode,
      stdout,
      stderr,
    }
  } finally {
    if (args.signal) {
      try {
        args.signal.removeEventListener('abort', onAbort)
      } catch {}
    }
  }
}

export function mergeAbortSignals(signals: Array<AbortSignal | undefined>): {
  signal: AbortSignal
  cleanup: () => void
} {
  const controller = new AbortController()
  const onAbort = () => controller.abort()

  const cleanups: Array<() => void> = []
  for (const signal of signals) {
    if (!signal) continue
    if (signal.aborted) {
      controller.abort()
      continue
    }
    signal.addEventListener('abort', onAbort, { once: true })
    cleanups.push(() => {
      try {
        signal.removeEventListener('abort', onAbort)
      } catch {}
    })
  }

  return {
    signal: controller.signal,
    cleanup: () => cleanups.forEach(fn => fn()),
  }
}

export function withHookTimeout(args: {
  timeoutSeconds?: number
  parentSignal?: AbortSignal
  fallbackTimeoutMs: number
}): { signal: AbortSignal; cleanup: () => void } {
  const timeoutMs =
    typeof args.timeoutSeconds === 'number' &&
    Number.isFinite(args.timeoutSeconds)
      ? Math.max(0, Math.floor(args.timeoutSeconds * 1000))
      : args.fallbackTimeoutMs

  const timeoutSignal =
    typeof AbortSignal !== 'undefined' &&
    typeof (AbortSignal as any).timeout === 'function'
      ? (AbortSignal as any).timeout(timeoutMs)
      : (() => {
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), timeoutMs)
          const signal = controller.signal
          ;(signal as any).__cleanup = () => clearTimeout(timer)
          return signal
        })()

  const merged = mergeAbortSignals([args.parentSignal, timeoutSignal])
  const timeoutCleanup =
    typeof (timeoutSignal as any).__cleanup === 'function'
      ? (timeoutSignal as any).__cleanup
      : () => {}

  return {
    signal: merged.signal,
    cleanup: () => {
      merged.cleanup()
      timeoutCleanup()
    },
  }
}
