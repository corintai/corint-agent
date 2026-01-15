import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  findMostRecentKodeAgentSessionId,
  loadKodeAgentSessionLogData,
  loadKodeAgentSessionMessages,
} from '@utils/protocol/kodeAgentSessionLoad'
import {
  getSessionLogFilePath,
  sanitizeProjectNameForSessionStore,
} from '@utils/protocol/kodeAgentSessionLog'
import { setKodeAgentSessionId } from '@utils/protocol/kodeAgentSessionId'

describe('session loader (projects/*.jsonl)', () => {
  const originalConfigDir = process.env.KODE_CONFIG_DIR

  let configDir: string
  let projectDir: string

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'kode-claude-load-config-'))
    projectDir = mkdtempSync(join(tmpdir(), 'kode-claude-load-project-'))
    process.env.KODE_CONFIG_DIR = configDir
    setKodeAgentSessionId('11111111-1111-1111-1111-111111111111')
  })

  afterEach(() => {
    if (originalConfigDir === undefined) {
      delete process.env.KODE_CONFIG_DIR
    } else {
      process.env.KODE_CONFIG_DIR = originalConfigDir
    }
    rmSync(configDir, { recursive: true, force: true })
    rmSync(projectDir, { recursive: true, force: true })
  })

  test('loads user/assistant messages from a session jsonl file', () => {
    const sessionId = '22222222-2222-2222-2222-222222222222'
    const path = getSessionLogFilePath({ cwd: projectDir, sessionId })
    mkdirSync(
      join(
        configDir,
        'projects',
        sanitizeProjectNameForSessionStore(projectDir),
      ),
      {
        recursive: true,
      },
    )

    const lines =
      [
        JSON.stringify({
          type: 'file-history-snapshot',
          messageId: 'm1',
          snapshot: {
            messageId: 'm1',
            trackedFileBackups: {},
            timestamp: new Date().toISOString(),
          },
          isSnapshotUpdate: false,
        }),
        JSON.stringify({
          type: 'user',
          sessionId,
          uuid: 'u1',
          message: { role: 'user', content: 'hello' },
        }),
        JSON.stringify({
          type: 'assistant',
          sessionId,
          uuid: 'a1',
          message: {
            id: 'msg1',
            model: 'x',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'hi' }],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        }),
      ].join('\n') + '\n'
    writeFileSync(path, lines, 'utf8')

    const messages = loadKodeAgentSessionMessages({
      cwd: projectDir,
      sessionId,
    })
    expect(messages.length).toBe(2)
    expect(messages[0].type).toBe('user')
    expect((messages[0] as any).message.content).toBe('hello')
    expect(messages[1].type).toBe('assistant')
    expect((messages[1] as any).message.role).toBe('assistant')
  })

  test('loads summary/custom-title/tag metadata from session log', () => {
    const sessionId = '55555555-5555-5555-5555-555555555555'
    const path = getSessionLogFilePath({ cwd: projectDir, sessionId })
    mkdirSync(
      join(
        configDir,
        'projects',
        sanitizeProjectNameForSessionStore(projectDir),
      ),
      {
        recursive: true,
      },
    )

    const lines =
      [
        JSON.stringify({
          type: 'file-history-snapshot',
          messageId: 'm1',
          snapshot: {
            messageId: 'm1',
            trackedFileBackups: {},
            timestamp: new Date().toISOString(),
          },
          isSnapshotUpdate: false,
        }),
        JSON.stringify({
          type: 'user',
          sessionId,
          uuid: 'u1',
          message: { role: 'user', content: 'hello' },
        }),
        JSON.stringify({
          type: 'assistant',
          sessionId,
          uuid: 'a1',
          message: {
            id: 'msg1',
            model: 'x',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'hi' }],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        }),
        JSON.stringify({ type: 'summary', summary: 'sum', leafUuid: 'a1' }),
        JSON.stringify({
          type: 'custom-title',
          sessionId,
          customTitle: 'My Session',
        }),
        JSON.stringify({ type: 'tag', sessionId, tag: 'pr' }),
      ].join('\n') + '\n'
    writeFileSync(path, lines, 'utf8')

    const data = loadKodeAgentSessionLogData({ cwd: projectDir, sessionId })
    expect(data.summaries.get('a1')).toBe('sum')
    expect(data.customTitles.get(sessionId)).toBe('My Session')
    expect(data.tags.get(sessionId)).toBe('pr')
    expect(data.fileHistorySnapshots.get('m1')?.type).toBe(
      'file-history-snapshot',
    )
  })

  test('findMostRecentKodeAgentSessionId picks newest jsonl by mtime', () => {
    const projectRoot = join(
      configDir,
      'projects',
      sanitizeProjectNameForSessionStore(projectDir),
    )
    mkdirSync(projectRoot, { recursive: true })

    const older = join(
      projectRoot,
      '33333333-3333-3333-3333-333333333333.jsonl',
    )
    const newer = join(
      projectRoot,
      '44444444-4444-4444-4444-444444444444.jsonl',
    )
    writeFileSync(
      older,
      JSON.stringify({
        type: 'user',
        uuid: 'u',
        message: { role: 'user', content: 'old' },
      }) + '\n',
      'utf8',
    )
    writeFileSync(
      newer,
      JSON.stringify({
        type: 'user',
        uuid: 'u',
        message: { role: 'user', content: 'new' },
      }) + '\n',
      'utf8',
    )

    const now = Date.now() / 1000
    utimesSync(older, now - 10, now - 10)
    utimesSync(newer, now, now)

    expect(findMostRecentKodeAgentSessionId(projectDir)).toBe(
      '44444444-4444-4444-4444-444444444444',
    )
  })
})
