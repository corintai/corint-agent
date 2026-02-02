import type { TimeWindowGroup, WindowSpec, WindowUnit } from './types'

const UNIT_SECONDS: Record<WindowUnit, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
  w: 604800,
  mo: 2629800,
  y: 31557600,
}

const WINDOW_PATTERN =
  /^(\d+)(s|m|h|d|w|mo|y)(?:_(\d+)(s|m|h|d|w|mo|y))?$/

export function parseWindowLabel(label: string): WindowSpec | null {
  const match = label.match(WINDOW_PATTERN)
  if (!match) return null

  const value = Number(match[1])
  const unit = match[2] as WindowUnit
  const seconds = value * UNIT_SECONDS[unit]

  return {
    value,
    unit,
    label: `${value}${unit}`,
    seconds,
  }
}

export function buildWindowSpec(
  value: number,
  unit: WindowUnit,
  group?: string,
): WindowSpec {
  const label = `${value}${unit}`
  return {
    value,
    unit,
    label,
    seconds: value * UNIT_SECONDS[unit],
    group,
    groupType: group ? inferWindowGroupType(group) : undefined,
  }
}

export function inferWindowGroupType(group: string): string {
  if (group.startsWith('realtime')) return 'realtime'
  if (group === 'short_term') return 'short_term'
  if (group === 'mid_term') return 'mid_term'
  if (group === 'long_term') return 'long_term'
  if (group.startsWith('calendar')) return 'calendar'
  return group
}

export function getAllWindows(
  timeWindows: Record<string, TimeWindowGroup>,
): WindowSpec[] {
  const windows: WindowSpec[] = []
  for (const [group, def] of Object.entries(timeWindows)) {
    for (const value of def.values) {
      windows.push(buildWindowSpec(value, def.unit, group))
    }
  }
  return windows
}

export function compareWindows(a: WindowSpec, b: WindowSpec): number {
  return a.seconds - b.seconds
}

export function parseWindowPairFromParts(
  parts: string[],
): { window?: WindowSpec; windowPair?: string; remaining: string[] } {
  if (parts.length === 0) {
    return { remaining: parts }
  }

  const last = parts[parts.length - 1]
  const secondLast = parts.length > 1 ? parts[parts.length - 2] : null
  const lastParsed = parseWindowLabel(last)

  if (lastParsed && secondLast) {
    const secondParsed = parseWindowLabel(secondLast)
    if (secondParsed) {
      const windowPair = `${secondParsed.label}_${lastParsed.label}`
      return {
        windowPair,
        remaining: parts.slice(0, -2),
      }
    }
  }

  if (lastParsed) {
    return {
      window: lastParsed,
      remaining: parts.slice(0, -1),
    }
  }

  return { remaining: parts }
}
