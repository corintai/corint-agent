export type RequestStatusKind = 'idle' | 'thinking' | 'streaming' | 'tool'

export type RequestStatus = {
  kind: RequestStatusKind
  detail?: string
  task?: string
  updatedAt: number
}

const TOOL_DETAIL_MAX_LENGTH = 80

function normalizeSnippet(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function truncateSnippet(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  if (maxLength <= 3) return value.slice(0, maxLength)
  return `${value.slice(0, maxLength - 3)}...`
}

export function formatToolStatusDetail(
  toolName?: string,
  input?: Record<string, unknown> | null,
): string | undefined {
  if (!toolName) return undefined
  if (toolName !== 'Bash') return toolName
  const command =
    input && typeof input.command === 'string' ? input.command : ''
  const normalized = normalizeSnippet(command)
  if (!normalized) return 'Bash'
  const truncated = truncateSnippet(normalized, TOOL_DETAIL_MAX_LENGTH)
  return `Bash(${truncated})`
}

let current: RequestStatus = { kind: 'idle', updatedAt: Date.now() }
const listeners = new Set<(status: RequestStatus) => void>()

export function getRequestStatus(): RequestStatus {
  return current
}

export function setRequestStatus(
  status: Omit<RequestStatus, 'updatedAt'>,
): void {
  const normalizedTask =
    typeof status.task === 'string' && status.task.trim()
      ? status.task.trim()
      : undefined
  let task: string | undefined
  if (status.kind === 'idle') {
    task = undefined
  } else if (normalizedTask) {
    task = normalizedTask
  } else if (current.kind === 'idle') {
    task = undefined
  } else {
    task = current.task
  }

  current = {
    kind: status.kind,
    detail: status.detail,
    task,
    updatedAt: Date.now(),
  }
  for (const listener of listeners) listener(current)
}

export function setRequestTask(task: string | null): void {
  const normalized =
    typeof task === 'string' && task.trim() ? task.trim() : undefined
  current = { ...current, task: normalized, updatedAt: Date.now() }
  for (const listener of listeners) listener(current)
}

export function subscribeRequestStatus(
  listener: (status: RequestStatus) => void,
): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
