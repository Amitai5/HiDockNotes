import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { queryOne, run, upsertRecordingFromDevice } from '@hidock/core/services/database'
import { createApplication } from '../application'

const { chat } = vi.hoisted(() => ({ chat: vi.fn() }))
vi.mock('@hidock/core/ai/provider-factory', () => ({ providerFactory: () => () => ({ chat, listModels: async () => [{ id: 'test-chat', name: 'Test chat', chat: true, transcription: false }] }) }))
const origin = 'http://localhost:3000', options = () => ({ days: 30 })
let folder: string, app: Awaited<ReturnType<typeof createApplication>>, headers: Record<string, string>, project: string, recording: string
const rpc = (operation: string, args: unknown[] = [], supplied = headers) => app.inject({ method: 'POST', url: '/api/v1/rpc/' + operation, headers: supplied, payload: { args } })
beforeEach(async () => {
  chat.mockReset().mockResolvedValue(JSON.stringify({ overview: [{ text: 'The pilot is ready for review.', sources: [1] }], changes: [], decisions: [], questions: [] }))
  folder = await mkdtemp(join(tmpdir(), 'hidock-briefing-rpc-'))
  app = await createApplication({ dataPath: join(folder, 'data'), backupPath: join(folder, 'backups'), origin, processing: false, setupLog: () => undefined }); await app.ready()
  const token = await readFile(join(folder, 'data', 'secrets/setup-code'), 'utf8')
  const owner = await app.inject({ method: 'POST', url: '/api/v1/auth/setup', headers: { origin }, payload: { token, username: 'owner', password: 'isolated-briefing-password' } })
  headers = { origin, cookie: owner.cookies.map(cookie => cookie.name + '=' + cookie.value).join('; '), 'x-csrf-token': owner.json().csrf }
  project = (await rpc('projects:create', ['Pilot'])).json().result.id
  recording = upsertRecordingFromDevice({ filename: 'pilot.hda', size: 100, duration: 60, dateCreated: new Date(Date.now() - 3600000) }).id
  run('UPDATE recordings SET verified=1,project_id=? WHERE id=?', [project, recording])
  run('INSERT INTO summaries(id,recording_id,text,outcomes) VALUES (?,?,?,?)', ['summary', recording, 'The pilot is ready for review.', '[]'])
  expect((await rpc('ai:verify', ['gemini', 'AQ.synthetic-test-key'])).statusCode).toBe(200)
  expect((await rpc('ai:settings', [{ chat: { provider: 'gemini', model: 'test-chat' } }])).statusCode).toBe(200)
})
afterEach(async () => { await app.close(); await rm(folder, { recursive: true, force: true }) })

describe('authenticated project briefing HTTP boundary', () => {
  it('reads without generation, generates explicitly, and reloads the saved briefing after restart', async () => {
    expect((await rpc('project-briefing:get', [project, options()])).json().result.briefing).toBeNull(); expect(chat).not.toHaveBeenCalled()
    const generated = await rpc('project-briefing:generate', [project, options()])
    expect(generated.statusCode, generated.body).toBe(200); expect(generated.json().result.briefing.content.overview[0].text).toBe('The pilot is ready for review.')
    await app.close(); app = await createApplication({ dataPath: join(folder, 'data'), backupPath: join(folder, 'backups'), origin, processing: false, setupLog: () => undefined }); await app.ready()
    const loaded = await rpc('project-briefing:get', [project, options()]); expect(loaded.statusCode).toBe(200)
    expect(loaded.json().result.briefing).toEqual(generated.json().result.briefing); expect(chat).toHaveBeenCalledTimes(1)
  })
  it('requires authentication, an allowed origin and CSRF even for cache lookup', async () => {
    expect((await rpc('project-briefing:get', [project, options()], { origin })).statusCode).toBe(401)
    expect((await rpc('project-briefing:generate', [project, options()], { ...headers, 'x-csrf-token': 'wrong' })).statusCode).toBe(403)
    expect((await rpc('project-briefing:generate', [project, options()], { ...headers, origin: 'https://other.example' })).statusCode).toBe(403)
    expect(chat).not.toHaveBeenCalled()
  })
  it('rejects missing projects and malformed options before requesting AI', async () => {
    for (const args of [[null, options()], [project, { days: 500, today: '2026-11-03' }], ['11111111-1111-4111-8111-111111111111', options()]]) expect((await rpc('project-briefing:generate', args)).statusCode).toBe(400)
    expect(chat).not.toHaveBeenCalled()
  })
  it('removes derived briefing text when a source recording is deleted', async () => {
    expect((await rpc('project-briefing:generate', [project, options()])).statusCode).toBe(200)
    expect(queryOne('SELECT value FROM settings WHERE key=?', [`project-briefing:${project}:30`])).toBeTruthy()
    const deleted = await rpc('library:delete', [recording, true]); expect(deleted.statusCode, deleted.body).toBe(200)
    expect(queryOne('SELECT value FROM settings WHERE key=?', [`project-briefing:${project}:30`])).toBeUndefined()
  })
})
