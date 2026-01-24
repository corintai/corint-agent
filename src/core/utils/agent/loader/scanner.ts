import { statSync } from 'fs'
import type { AgentConfig, AgentSource } from './types'
import { listMarkdownFilesRecursively } from './markdown'
import { parseAgentFromFile } from './parser'
import { inodeKeyForPath } from './paths'

export function mergeAgents(allAgents: AgentConfig[]): AgentConfig[] {
  const builtIn = allAgents.filter(a => a.source === 'built-in')
  const plugin = allAgents.filter(a => a.source === 'plugin')
  const user = allAgents.filter(a => a.source === 'userSettings')
  const project = allAgents.filter(a => a.source === 'projectSettings')
  const flag = allAgents.filter(a => a.source === 'flagSettings')
  const policy = allAgents.filter(a => a.source === 'policySettings')

  const ordered = [builtIn, plugin, user, project, flag, policy]
  const map = new Map<string, AgentConfig>()
  for (const group of ordered) {
    for (const agent of group) {
      map.set(agent.agentType, agent)
    }
  }
  return Array.from(map.values())
}

export function scanAgentPaths(options: {
  dirPathOrFile: string
  baseDir: string
  source: Exclude<AgentSource, 'built-in' | 'flagSettings'>
  seenInodes: Map<string, AgentSource>
}): AgentConfig[] {
  const out: AgentConfig[] = []

  const addFile = (filePath: string) => {
    if (!filePath.endsWith('.md')) return

    const inodeKey = inodeKeyForPath(filePath)
    if (inodeKey) {
      const existing = options.seenInodes.get(inodeKey)
      if (existing) return
      options.seenInodes.set(inodeKey, options.source)
    }

    const agent = parseAgentFromFile({
      filePath,
      baseDir: options.baseDir,
      source: options.source,
    })
    if (agent) out.push(agent)
  }

  let st: ReturnType<typeof statSync>
  try {
    st = statSync(options.dirPathOrFile)
  } catch {
    return []
  }

  if (st.isFile()) {
    addFile(options.dirPathOrFile)
    return out
  }

  if (!st.isDirectory()) return []

  for (const filePath of listMarkdownFilesRecursively(options.dirPathOrFile)) {
    addFile(filePath)
  }

  return out
}
