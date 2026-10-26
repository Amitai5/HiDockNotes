import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { queryOne } from '@hidock/core/services/database'
import { saveProcessingResult, savedTranscript, saveTranscript } from '@hidock/core/ai/processing-store'
import { DEFAULT_AI_SETTINGS } from '@hidock/core/shared/ai'
import { wavHeader } from '@hidock/core/services/realtime-recorder'
import { createApplication } from '../application'

let folder: string, app: Awaited<ReturnType<typeof createApplication>>, headers: Record<string, string>
const origin = 'http://localhost:3000'
const audio = Buffer.concat([wavHeader(64000), Buffer.alloc(64000)]), checksum = createHash('sha256').update(audio).digest('hex')
const rpc = (operation: string, args: unknown[] = []) => app.inject({ method: 'POST', url: '/api/v1/rpc/' + operation, headers, payload: { args } })
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'hidock-recording-titles-'))
  app = await createApplication({ dataPath: join(folder, 'data'), backupPath: join(folder, 'backups'), origin, processing: false, setupLog: () => undefined })
  await app.ready()
  const token = await readFile(join(folder, 'data', 'secrets', 'setup-code'), 'utf8')
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/setup', headers: { origin }, payload: { token, username: 'owner', password: 'isolated-title-password' } })
  expect(login.statusCode).toBe(200)
  headers = { origin, cookie: login.cookies.map(cookie => cookie.name + '=' + cookie.value).join('; '), 'x-csrf-token': login.json().csrf }
})
afterEach(async () => { await app.close(); await rm(folder, { recursive: true, force: true }) })
async function imported(serial?: string) {
  const created = await app.inject({ method: 'POST', url: '/api/v1/uploads', headers, payload: { filename: 'meeting.wav', size: audio.length, checksum, ...(serial ? { serial, deviceFilename: 'meeting.wav' } : {}) } })
  expect(created.statusCode, created.body).toBe(200)
  const upload = created.json().id as string
  expect((await app.inject({ method: 'PUT', url: '/api/v1/uploads/' + upload + '?offset=0', headers: { ...headers, 'content-type': 'application/octet-stream' }, payload: audio })).statusCode).toBe(200)
  const done = await app.inject({ method: 'POST', url: '/api/v1/uploads/' + upload + '/complete', headers, payload: {} })
  expect(done.statusCode, done.body).toBe(200)
  return { id: done.json().recording_id as string, upload }
}
const checkpoint = { duration: 1, speakers: [], segments: [{ id: 'segment', start: 0, end: 1, text: 'We approved the launch checklist.', speakerId: null, speakerName: null }] }
const summary = { title: 'Launch Checklist Review', summary: 'The launch checklist was approved.', actionItems: [] }
describe('audio recording title provenance', () => {
  it.each([undefined, 'recorder-one'])('replaces an imported filename with the summary title for %s', async serial => {
    const { id } = await imported(serial)
    expect(queryOne('SELECT title,title_source FROM recordings WHERE id=?', [id])).toEqual({ title: 'meeting.wav', title_source: 'placeholder' })
    saveTranscript(id, checkpoint, DEFAULT_AI_SETTINGS)
    const before = queryOne('SELECT * FROM transcripts WHERE recording_id=?', [id]), identity = queryOne('SELECT filename,file_path,checksum FROM recordings WHERE id=?', [id])

    saveProcessingResult(id, { ...savedTranscript(id), transcriptChanged: false, empty: false, summary }, DEFAULT_AI_SETTINGS)

    expect((await rpc('library:detail', [id])).json().result.recording).toMatchObject({ title: summary.title, summary: summary.summary, status: 'done' })
    expect((await rpc('library:content', [{}])).json().result.items[0].title).toBe(summary.title)
    expect((await rpc('library:list', ['Launch Checklist', ''])).json().result[0].id).toBe(id)
    expect(queryOne('SELECT title_source FROM recordings WHERE id=?', [id])).toEqual({ title_source: 'ai' })
    expect(queryOne('SELECT * FROM transcripts WHERE recording_id=?', [id])).toEqual(before)
    expect(queryOne('SELECT filename,file_path,checksum FROM recordings WHERE id=?', [id])).toEqual(identity)
  })
  it('preserves a deliberate manual filename title through summary completion and repeated upload completion', async () => {
    const { id, upload } = await imported()
    expect((await rpc('library:rename', [id, 'meeting.wav'])).statusCode).toBe(200)
    const repeated = await app.inject({ method: 'POST', url: '/api/v1/uploads/' + upload + '/complete', headers, payload: {} })
    expect(repeated.statusCode).toBe(200)

    saveProcessingResult(id, { ...checkpoint, empty: false, summary }, DEFAULT_AI_SETTINGS)

    expect(queryOne('SELECT title,title_source FROM recordings WHERE id=?', [id])).toEqual({ title: 'meeting.wav', title_source: 'manual' })
  })
  it.each([false, true])('replaces the automatic live-capture title after summary, interrupted=%s', async interrupted => {
    const capture = (await app.inject({ method: 'POST', url: '/api/v1/captures', headers, payload: { serial: 'recorder-one' } })).json().id as string
    expect((await app.inject({ method: 'PUT', url: '/api/v1/captures/' + capture + '?sequence=0', headers: { ...headers, 'content-type': 'application/octet-stream' }, payload: Buffer.alloc(64000) })).statusCode).toBe(200)
    if (interrupted) expect((await app.inject({ method: 'POST', url: '/api/v1/captures/' + capture + '/interrupt', headers, payload: {} })).statusCode).toBe(200)
    const done = await app.inject({ method: 'POST', url: '/api/v1/captures/' + capture + '/finish', headers, payload: {} })
    expect(done.statusCode, done.body).toBe(200)
    const id = done.json().recordingId as string
    expect(queryOne('SELECT title_source FROM recordings WHERE id=?', [id])).toEqual({ title_source: 'placeholder' })

    saveProcessingResult(id, { ...checkpoint, empty: false, summary }, DEFAULT_AI_SETTINGS)

    expect((await rpc('library:detail', [id])).json().result.recording.title).toBe(summary.title)
  })
})
