import { randomUUID } from 'crypto'

export function makeBackgroundTaskId(): string {
  return `b${randomUUID().replace(/-/g, '').slice(0, 6)}`
}
