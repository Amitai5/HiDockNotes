import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createApplication } from '../application'
import { queryOne } from '@hidock/core/services/database'
import type { NoteDocument, NoteSave } from '@hidock/core/shared/notes'

let folder: string, app: Awaited<ReturnType<typeof createApplication>>, headers: Record<string, string>
const origin = 'https://notes.example', requestId = '11111111-1111-4111-8111-111111111111', mutationId = '22222222-2222-4222-8222-222222222222'
const rpc = (operation: string, args: unknown[] = [], supplied = headers) => app.inject({ method: 'POST', url: '/api/v1/rpc/' + operation, headers: supplied, payload: { args } })
const document = (): NoteDocument => ({ type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'body' }, content: [{ type: 'text', text: 'Answer [1]', marks: [{ type: 'bold' }, { type: 'link', attrs: { href: origin + '/#/library/33333333-3333-4333-8333-333333333333?t=12' } }] }] }, { type: 'codeBlock', attrs: { id: 'code', language: 'js' }, content: [{ type: 'text', text: 'const result = 42;' }] }] })
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'hidock-answer-http-')); app = await createApplication({ dataPath: join(folder, 'data'), backupPath: join(folder, 'backups'), origin, additionalOrigins: ['http://truenas.local:10708'], processing: false, setupLog: () => undefined }); await app.ready()
  const token = await readFile(join(folder, 'data/secrets/setup-code'), 'utf8'), owner = await app.inject({ method: 'POST', url: '/api/v1/auth/setup', headers: { origin }, payload: { token, username: 'owner', password: 'isolated-answer-notes-password' } })
  headers = { origin, cookie: owner.cookies.map(cookie => cookie.name + '=' + cookie.value).join('; '), 'x-csrf-token': owner.json().csrf }
})
afterEach(async () => { await app.close(); await rm(folder, { recursive: true, force: true }) })
async function create() { const result = await rpc('notes:create', [{ requestId, title: 'Saved answer', projectId: null, document: document(), tags: ['personal'] }]); expect(result.statusCode, result.body).toBe(200); return result.json().result }
describe('Assistant notes use the authenticated revision-safe notes boundary', () => {
  it('returns the public server address even when accessed through an allowed LAN alias', async () => {
    const result = await rpc('app:info', [], { ...headers, origin: 'http://truenas.local:10708' })
    expect(result.statusCode, result.body).toBe(200); expect(result.json().result.origin).toBe(origin)
  })
  it('creates once, preserves formatting/source links and exports clickable Markdown', async () => {
    const note = await create(), again = await create(); expect(again.id).toBe(note.id)
    expect(queryOne('SELECT count(*) AS count FROM written_notes')).toEqual({ count: 1 })
    const saved = (await rpc('notes:get', [note.id])).json().result; expect(saved.document).toEqual(document())
    const exported = (await rpc('notes:export', [note.id, 'markdown'])).json().result.text
    expect(exported).toContain(origin + '/#/library/'); expect(exported).toContain('```js\nconst result = 42;\n```')
  })
  it('commits an identical append mutation only once and records exactly one new revision', async () => {
    const note = await create(), appended = document(); appended.content.push({ type: 'paragraph', attrs: { id: 'added' }, content: [{ type: 'text', text: 'Added answer.' }] })
    const input: NoteSave = { formatVersion: 2, title: note.title, tags: note.tags, document: appended, expectedRevision: 1, mutationId }
    const results = await Promise.all([rpc('notes:save', [note.id, input]), rpc('notes:save', [note.id, input])])
    expect(results.map(result => result.statusCode)).toEqual([200, 200]); expect(results.map(result => result.json().result.note.revision)).toEqual([2, 2])
    expect((await rpc('notes:history', [note.id])).json().result).toHaveLength(2)
    expect((await rpc('notes:get', [note.id])).json().result.document).toEqual(appended)
  })
  it('rejects stale append content without overwriting a concurrent manual edit', async () => {
    const note = await create(), first = { formatVersion: 2, title: 'Manual new title', tags: ['new tag'], document: document(), expectedRevision: 1, mutationId }
    await rpc('notes:save', [note.id, first])
    const stale = await rpc('notes:save', [note.id, { ...first, title: 'Would overwrite', mutationId: '44444444-4444-4444-8444-444444444444' }])
    expect(stale.statusCode).toBe(200); expect(stale.json().result).toMatchObject({ status: 'conflict', current: { title: 'Manual new title', tags: ['new tag'], revision: 2 } })
    expect((await rpc('notes:get', [note.id])).json().result.title).toBe('Manual new title')
  })
  it('requires owner authentication, allowed origin and CSRF for saved answers', async () => {
    const input = { requestId, title: 'Answer', projectId: null, document: document() }
    expect((await rpc('notes:create', [input], { origin })).statusCode).toBe(401)
    expect((await rpc('notes:create', [input], { ...headers, origin: 'https://outside.example' })).statusCode).toBe(403)
    expect((await rpc('notes:create', [input], { ...headers, 'x-csrf-token': 'wrong' })).statusCode).toBe(403)
    expect(queryOne('SELECT count(*) AS count FROM written_notes')).toEqual({ count: 0 })
  })
})
