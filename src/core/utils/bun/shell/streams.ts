import { logError } from '@utils/log'

export function startStreamReader(
  stream: NodeJS.ReadableStream | null,
  append: (chunk: string) => void,
): void {
  if (!stream) return
  try {
    ;(stream as any).setEncoding?.('utf8')
  } catch {}
  stream.on('data', chunk => {
    append(
      typeof chunk === 'string'
        ? chunk
        : Buffer.isBuffer(chunk)
          ? chunk.toString('utf8')
          : String(chunk),
    )
  })
  stream.on('error', err => {
    logError(`Stream read error: ${err}`)
  })
}

export function createCancellableTextCollector(
  stream: NodeJS.ReadableStream | null,
  options?: { onChunk?: (chunk: string) => void; collectText?: boolean },
): {
  getText: () => string
  done: Promise<void>
  cancel: () => Promise<void>
} {
  let text = ''
  const collectText = options?.collectText !== false
  if (!stream) {
    return {
      getText: () => text,
      done: Promise.resolve(),
      cancel: async () => {},
    }
  }

  let cancelled = false

  let resolveDone: (() => void) | null = null
  const done = new Promise<void>(resolve => {
    resolveDone = resolve
  })

  const finish = () => {
    if (!resolveDone) return
    resolveDone()
    resolveDone = null
  }

  const onData = (chunk: unknown) => {
    if (cancelled) return
    const s =
      typeof chunk === 'string'
        ? chunk
        : Buffer.isBuffer(chunk)
          ? chunk.toString('utf8')
          : String(chunk)
    if (collectText) text += s
    options?.onChunk?.(s)
  }

  const onEnd = () => {
    cleanup()
    finish()
  }

  const onClose = () => {
    cleanup()
    finish()
  }

  const cleanup = () => {
    stream.off('data', onData)
    stream.off('end', onEnd)
    stream.off('close', onClose)
    stream.off('error', onError)
  }

  const onError = (err: unknown) => {
    if (!cancelled) {
      logError(`Stream read error: ${err}`)
    }
    cleanup()
    finish()
  }

  try {
    ;(stream as any).setEncoding?.('utf8')
  } catch {}

  stream.on('data', onData)
  stream.once('end', onEnd)
  stream.once('close', onClose)
  stream.once('error', onError)

  return {
    getText: () => text,
    done,
    cancel: async () => {
      if (cancelled) return
      cancelled = true
      cleanup()
      finish()
    },
  }
}
