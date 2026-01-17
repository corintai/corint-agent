import { homedir } from 'os'
import { join } from 'path'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'

type JsonRpcMessage = {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: any
}

type SessionRecord = {
  sessionId: string
  prompts: string[]
}

const baseDir = process.env.CORINT_CONFIG_DIR ?? join(homedir(), '.corint')
const sessionDir = join(baseDir, 'acp-sessions')
mkdirSync(sessionDir, { recursive: true })

function send(msg: Record<string, unknown>): void {
  try {
    process.stdout.write(`${JSON.stringify(msg)}\n`)
  } catch {}
}

function getSessionPath(sessionId: string): string {
  return join(sessionDir, `${sessionId}.json`)
}

function loadSession(sessionId: string): SessionRecord {
  try {
    const raw = readFileSync(getSessionPath(sessionId), 'utf8')
    const parsed = JSON.parse(raw)
    if (
      parsed &&
      typeof parsed.sessionId === 'string' &&
      Array.isArray(parsed.prompts)
    ) {
      return parsed as SessionRecord
    }
  } catch {}
  return { sessionId, prompts: [] }
}

function saveSession(session: SessionRecord): void {
  try {
    writeFileSync(
      getSessionPath(session.sessionId),
      JSON.stringify(session, null, 2),
      'utf8',
    )
  } catch {}
}

function emitCommandsUpdate(sessionId: string): void {
  send({
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId,
      update: {
        sessionUpdate: 'available_commands_update',
        availableCommands: [],
      },
    },
  })
}

function emitModeUpdate(sessionId: string): void {
  send({
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId,
      update: {
        sessionUpdate: 'current_mode_update',
        currentModeId: 'default',
      },
    },
  })
}

function emitAgentChunk(sessionId: string, text: string): void {
  send({
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text },
      },
    },
  })
}

function handleInitialize(msg: JsonRpcMessage): void {
  send({
    jsonrpc: '2.0',
    id: msg.id ?? null,
    result: {
      protocolVersion: 1,
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: {
          embeddedContent: true,
          embeddedContext: true,
        },
      },
    },
  })
}

function handleSessionNew(msg: JsonRpcMessage): void {
  const sessionId = randomUUID()
  saveSession({ sessionId, prompts: [] })
  send({
    jsonrpc: '2.0',
    id: msg.id ?? null,
    result: { sessionId },
  })
  emitCommandsUpdate(sessionId)
  emitModeUpdate(sessionId)
}

function handleSessionPrompt(msg: JsonRpcMessage): void {
  const sessionId = msg.params?.sessionId
  if (typeof sessionId !== 'string') {
    send({
      jsonrpc: '2.0',
      id: msg.id ?? null,
      error: { code: -32602, message: 'Invalid sessionId' },
    })
    return
  }

  const promptParts = Array.isArray(msg.params?.prompt)
    ? msg.params.prompt
    : []
  const text = promptParts
    .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
    .join('')

  const session = loadSession(sessionId)
  if (text) {
    session.prompts.push(text)
    saveSession(session)
  }

  const shouldEcho =
    process.env.CORINT_ACP_ECHO === '1' || process.env.KODE_ACP_ECHO === '1'
  if (shouldEcho && text) {
    emitAgentChunk(sessionId, text)
  }

  send({
    jsonrpc: '2.0',
    id: msg.id ?? null,
    result: { stopReason: 'end_turn' },
  })
}

function handleSessionLoad(msg: JsonRpcMessage): void {
  const sessionId = msg.params?.sessionId
  if (typeof sessionId !== 'string') {
    send({
      jsonrpc: '2.0',
      id: msg.id ?? null,
      error: { code: -32602, message: 'Invalid sessionId' },
    })
    return
  }

  const session = loadSession(sessionId)
  for (const text of session.prompts) {
    if (text) {
      emitAgentChunk(sessionId, text)
    }
  }

  send({
    jsonrpc: '2.0',
    id: msg.id ?? null,
    result: { modes: [] },
  })
}

function handleMessage(msg: JsonRpcMessage): void {
  switch (msg.method) {
    case 'initialize':
      handleInitialize(msg)
      return
    case 'session/new':
      handleSessionNew(msg)
      return
    case 'session/prompt':
      handleSessionPrompt(msg)
      return
    case 'session/load':
      handleSessionLoad(msg)
      return
    default:
      if (msg.id === undefined) return
      send({
        jsonrpc: '2.0',
        id: msg.id ?? null,
        error: { code: -32601, message: 'Method not found' },
      })
  }
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  buffer += chunk
  while (true) {
    const idx = buffer.indexOf('\n')
    if (idx < 0) break
    const line = buffer.slice(0, idx).trim()
    buffer = buffer.slice(idx + 1)
    if (!line) continue
    try {
      const msg = JSON.parse(line)
      handleMessage(msg)
    } catch {}
  }
})
