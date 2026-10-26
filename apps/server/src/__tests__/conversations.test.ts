import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { RecordingAssistant } from '@hidock/core/ai/assistant'
import { run } from '@hidock/core/services/database'
import type { ConversationDetail } from '@hidock/core/shared/conversations'
import { createApplication } from '../application'

const origin = 'http://localhost:3000'
let folder: string, app: Awaited<ReturnType<typeof createApplication>>, headers: Record<string, string>
const answer = vi.fn(async () => ({ text: 'The saved answer.', citations: [] }))
const rpc = (operation: string, args: unknown[] = []) => app.inject({ method: 'POST', url: '/api/v1/rpc/' + operation, headers, payload: { args } })
beforeEach(async () => {
  answer.mockClear()
  vi.spyOn(RecordingAssistant.prototype, 'ask').mockImplementation(answer)
  folder = await mkdtemp(join(tmpdir(), 'hidock-chat-rpc-'))
  app = await createApplication({ dataPath: join(folder, 'data'), backupPath: join(folder, 'backups'), origin, processing: false, setupLog: () => undefined })
  await app.ready()
  const token = await readFile(join(folder, 'data', 'secrets', 'setup-code'), 'utf8')
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/setup', headers: { origin }, payload: { token, username: 'owner', password: 'isolated-chat-password' } })
  expect(login.statusCode).toBe(200)
  headers = { origin, cookie: login.cookies.map(cookie => cookie.name + '=' + cookie.value).join('; '), 'x-csrf-token': login.json().csrf }
})
afterEach(async () => { await app.close(); vi.restoreAllMocks(); await rm(folder, { recursive: true, force: true }) })

describe('saved Assistant chat HTTP boundary', () => {
  it('refreshes a saved answer with an omitted or legacy null cursor and accepts the next question', async () => {
    const chat = (await rpc('conversations:create', [null])).json().result as ConversationDetail
    const id = chat.conversation.id
    const sent = await rpc('conversations:send', [id, 'First question', 0])
    expect(sent.statusCode, sent.body).toBe(200)

    for (const args of [[id], [id, null]]) {
      const refreshed = await rpc('conversations:get', args)
      expect(refreshed.statusCode, refreshed.body).toBe(200)
      expect(refreshed.json().result).toEqual(sent.json().result)
    }
    const followed = await rpc('conversations:send', [id, 'Follow-up question', 1])
    expect(followed.statusCode, followed.body).toBe(200)
    expect(followed.json().result.conversation).toMatchObject({ version: 2, messageCount: 4, responding: false })
    expect(answer).toHaveBeenLastCalledWith('Follow-up question', null, [{ role: 'user', content: 'First question' }, { role: 'assistant', content: 'The saved answer.' }], expect.any(AbortSignal))
  })
  it('uses explicit cursors to load older messages without treating zero as absent', async () => {
    const chat = (await rpc('conversations:create', [null])).json().result as ConversationDetail
    const id = chat.conversation.id
    for (let index = 0; index < 82; index++) run('INSERT INTO assistant_messages(id,conversation_id,ordinal,role,content,citations,created_at) VALUES (?,?,?,?,?,?,?)', ['message-' + index, id, index, index % 2 ? 'assistant' : 'user', 'Message ' + index, '[]', chat.conversation.createdAt])

    const latest = (await rpc('conversations:get', [id, null])).json().result as ConversationDetail
    expect(latest.messages).toHaveLength(80)
    expect(latest.hasEarlier).toBe(true)
    const earlier = (await rpc('conversations:get', [id, latest.messages[0].ordinal])).json().result as ConversationDetail
    expect(earlier.messages.map(message => message.ordinal)).toEqual([0, 1])
    expect(earlier.hasEarlier).toBe(false)
    expect((await rpc('conversations:get', [id, 0])).json().result.messages).toEqual([])
  })
  it('still rejects missing and malformed write versions without generating or changing messages', async () => {
    const chat = (await rpc('conversations:create', [null])).json().result as ConversationDetail
    const id = chat.conversation.id
    for (const invalid of [null, -1, 0.5, '0', false]) {
      for (const operation of ['conversations:send', 'conversations:rename']) expect((await rpc(operation, [id, 'Question or title', invalid])).statusCode).toBe(400)
    }
    expect((await rpc('conversations:send', [id, 'Question'])).statusCode).toBe(400)
    expect(answer).not.toHaveBeenCalled()
    expect((await rpc('conversations:get', [id])).json().result).toMatchObject({ conversation: { version: 0, title: 'New chat' }, messages: [] })
  })
  it('still rejects a valid but stale write version', async () => {
    const chat = (await rpc('conversations:create', [null])).json().result as ConversationDetail
    const id = chat.conversation.id
    expect((await rpc('conversations:rename', [id, 'Saved title', 0])).statusCode).toBe(200)
    for (const operation of ['conversations:send', 'conversations:rename']) {
      const stale = await rpc(operation, [id, 'Stale write', 0])
      expect(stale.statusCode).toBe(400)
      expect(stale.json().error).toContain('This chat changed.')
    }
    expect(answer).not.toHaveBeenCalled()
  })
  it('reports a malformed history cursor separately from a write version', async () => {
    const chat = (await rpc('conversations:create', [null])).json().result as ConversationDetail
    for (const invalid of [-1, 1.5, '2', false, Number.MAX_SAFE_INTEGER + 1]) {
      const result = await rpc('conversations:get', [chat.conversation.id, invalid])
      expect(result.statusCode).toBe(400)
      expect(result.json().error).toContain('Invalid chat history cursor.')
    }
  })
})
