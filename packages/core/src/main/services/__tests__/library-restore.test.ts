import Database from 'better-sqlite3'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises'
import { existsSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import { closeDatabase, createProject, getDatabase, getDetail, initializeDatabase, queryOne, run, upsertRecordingFromDevice, DATABASE_SCHEMA_VERSION } from '../database'
import { LibraryBackupService } from '../library-backup'
import { LibraryRestoreService, applyPendingRestore } from '../library-restore'
import { tarHeader } from '../backup-archive'
import { saveTranscript } from '../../ai/processing-store'
import { editTranscript, transcriptReview } from '../transcript-revisions'
import { DEFAULT_AI_SETTINGS } from '../../../../src/shared/ai'
import { readReferenceContext, saveReferenceContext } from '../reference-context'
import { EMPTY_REFERENCE_CONTEXT } from '../../../../src/shared/reference-context'
import { removeSchema12 } from './schema-fixtures'

let root: string, data: string, archive: string, id: string, restore: LibraryRestoreService, backups: LibraryBackupService
const audio = Buffer.from('fixture original audio, never a real recording'), date = '2026-10-20T10:00:00.000Z'
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'hidocknotes-restore-test-')); data = join(root, 'app'); archive = join(root, 'complete.tar.gz')
  await mkdir(join(data, 'data'), { recursive: true })
  initializeDatabase(join(data, 'data', 'library.db'))
  const source = join(root, 'original.wav'); await writeFile(source, audio)
  id = upsertRecordingFromDevice({ filename: 'call.hda', size: audio.length, duration: 9, dateCreated: new Date(date) }).id
  run("UPDATE recordings SET title='Archived meeting',file_path=?,verified=1,checksum=?,status='done' WHERE id=?", [source, createHash('sha256').update(audio).digest('hex'), id])
  run("INSERT INTO actionables(id,recording_id,text,done,due_date,owner) VALUES ('task',?,'Send the plan',1,'2026-11-01','Dana')", [id])
  run("INSERT INTO recording_tags VALUES (?,'planning','manual')", [id])
  run("INSERT INTO voice_profiles VALUES ('voice','Dana',?)", [date])
  run("INSERT INTO voice_samples(id,voice_profile_id,embedding,source_recording,created_at) VALUES ('sample','voice',?,?,?)", [Buffer.from([1, 2, 3, 4]), id, date])
  saveTranscript(id, { duration: 9, speakers: [], segments: [{ id: 'segment', start: 0, end: 3, text: 'Original words', speakerId: null, speakerName: null }] }, DEFAULT_AI_SETTINGS)
  editTranscript(id, 'segment', 'Corrected words', transcriptReview(id).version)
  backups = new LibraryBackupService({ dataPath: data, database: getDatabase, version: '0.10.0', changed: () => undefined })
  restore = new LibraryRestoreService({ dataPath: data, changed: () => undefined })
  await backups.create(archive)
})
afterEach(async () => { await restore.stop(); await backups.stop(); closeDatabase(); await rm(root, { recursive: true, force: true }) })
describe('verified, recoverable library restore', () => {
  it('previews all data and restores audio paths, voices, tasks, tags and transcript revisions without changing external originals', async () => {
    run("UPDATE recordings SET title='Current library to preserve'")
    const preview = await restore.prepare(archive)
    expect(preview).toMatchObject({ localRecordings: 1, counts: { actionables: 1, voice_profiles: 1, voice_samples: 1, transcript_revisions: 2 } })
    expect(getDetail(id).recording.title).toBe('Current library to preserve')
    await restore.schedule(preview!.id); closeDatabase()
    expect(applyPendingRestore(data)).toBe(true)
    initializeDatabase(join(data, 'data', 'library.db'))
    expect(getDetail(id)).toMatchObject({ recording: { title: 'Archived meeting' }, tags: ['planning'], actionables: [{ done: true, owner: 'Dana', dueDate: '2026-11-01' }] })
    const file = queryOne<{ file_path: string }>('SELECT file_path FROM recordings WHERE id=?', [id])!.file_path
    expect(file.startsWith(join(data, 'restored', preview!.id))).toBe(true)
    expect(await readFile(file)).toEqual(audio)
    expect(await readFile(join(root, 'original.wav'))).toEqual(audio)
    expect(queryOne('SELECT embedding FROM voice_samples')).toEqual({ embedding: Buffer.from([1, 2, 3, 4]) })
    expect(transcriptReview(id).revisions).toHaveLength(2)
    expect(queryOne("SELECT value FROM settings WHERE key='restore-review-required'")).toEqual({ value: 'true' })
    const previous = new Database(join(data, 'data', `library-before-restore-${preview!.id}.db`), { readonly: true })
    try { expect(previous.prepare('SELECT title FROM recordings').get()).toEqual({ title: 'Current library to preserve' }) } finally { previous.close() }
    expect(applyPendingRestore(data)).toBe(false)
  })
  it('includes global and project context in existing complete backups and restores their saved versions', async () => {
    const project = createProject('Archived project')
    const global = saveReferenceContext(null, { ...EMPTY_REFERENCE_CONTEXT, terminology: 'Archived global terminology' }, 0)
    const scoped = saveReferenceContext(project.id, { ...EMPTY_REFERENCE_CONTEXT, background: 'Archived project background' }, 0)
    await backups.create(archive)
    saveReferenceContext(null, { ...EMPTY_REFERENCE_CONTEXT, terminology: 'Changed after backup' }, 1)
    const preview = await restore.prepare(archive)
    await restore.schedule(preview!.id); closeDatabase()
    expect(applyPendingRestore(data)).toBe(true)
    initializeDatabase(join(data, 'data', 'library.db'))
    expect(readReferenceContext(null)).toEqual(global)
    expect(readReferenceContext(project.id)).toEqual(scoped)
    expect(getDatabase().pragma('user_version', { simple: true })).toBe(DATABASE_SCHEMA_VERSION)
  })
  it('round-trips structured meeting outcomes and their original source quotes', async () => {
    const outcomes = JSON.stringify([{ kind: 'decision', text: 'Keep the corrected wording.', answerer: null, start: 0, evidence: 'Corrected words', source: 'transcript' }])
    run('INSERT INTO summaries(id,recording_id,text,outcomes) VALUES (?,?,?,?)', ['notes', id, '## Decisions\nKeep the corrected wording.', outcomes])
    await backups.create(archive)
    run('DELETE FROM summaries')
    const preview = await restore.prepare(archive)
    await restore.schedule(preview!.id); closeDatabase()
    expect(applyPendingRestore(data)).toBe(true)
    initializeDatabase(join(data, 'data', 'library.db'))
    expect(queryOne('SELECT outcomes FROM summaries WHERE recording_id=?', [id])).toEqual({ outcomes })
  })
  it('fails on corrupt or truncated audio and leaves the current database intact', async () => {
    const bytes = gunzipSync(await readFile(archive)), index = bytes.indexOf(audio)
    expect(index).toBeGreaterThan(0); bytes[index] ^= 1
    await writeFile(archive, gzipSync(bytes))
    await expect(restore.prepare(archive)).rejects.toThrow('SHA-256')
    expect(getDetail(id).segments[0].text).toBe('Corrected words')
    expect(existsSync(join(data, 'data', 'restore-pending.json'))).toBe(false)
    const compressed = await readFile(archive); await writeFile(archive, compressed.subarray(0, 150))
    await expect(restore.prepare(archive)).rejects.toThrow()
    expect(await readdir(join(data, 'restore-staging'))).toEqual([])
  })
  it.each(['../escape', '/absolute', 'recordings/link'])('rejects unsafe tar paths without writing outside the staging directory: %s', async name => {
    const header = tarHeader('README.txt', 1)
    header.fill(0, 0, 100); header.write(name)
    header.fill(32, 148, 156); header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148)
    await writeFile(archive, gzipSync(Buffer.concat([header, Buffer.from('x'), Buffer.alloc(511 + 1024)])))
    await expect(restore.prepare(archive)).rejects.toThrow('unsafe path')
    expect(existsSync(join(data, 'escape'))).toBe(false)
  })
  it('cancels a verified preview and refuses stale restore IDs', async () => {
    const preview = await restore.prepare(archive)
    await expect(restore.schedule('wrong')).rejects.toThrow('Verify')
    await restore.cancel()
    expect(restore.state().phase).toBe('idle')
    await expect(restore.schedule(preview!.id)).rejects.toThrow('Verify')
    expect(await readdir(join(data, 'restore-staging'))).toEqual([])
  })
  it('recovers an interrupted database handoff after the original was moved aside', async () => {
    const preview = await restore.prepare(archive)
    await restore.schedule(preview!.id); closeDatabase()
    renameSync(join(data, 'data', 'library.db'), join(data, 'data', `library-before-restore-${preview!.id}.db`))
    expect(applyPendingRestore(data)).toBe(true)
    initializeDatabase(join(data, 'data', 'library.db'))
    expect(getDetail(id).recording.title).toBe('Archived meeting')
  })
  it('restores a backup from the previous schema and migrates it after the verified handoff', async () => {
    removeSchema12()
    getDatabase().exec('DROP TABLE transcript_revisions; DROP TABLE transcript_corrections; DROP TABLE transcript_candidates; ALTER TABLE recording_overviews DROP COLUMN summary_version; PRAGMA user_version=10')
    await backups.create(archive)
    const preview = await restore.prepare(archive)
    await restore.schedule(preview!.id); closeDatabase()
    expect(applyPendingRestore(data)).toBe(true)
    initializeDatabase(join(data, 'data', 'library.db'))
    expect(getDatabase().pragma('user_version', { simple: true })).toBe(DATABASE_SCHEMA_VERSION)
    expect(getDetail(id).segments[0].text).toBe('Corrected words')
    expect(getDetail(id).actionables[0].done).toBe(true)
  })
  it('round-trips saved chats, messages and citations with calendar links, then disconnects calendar secrets and pauses optional search', async () => {
    const citations = JSON.stringify([{ number: 1, recordingId: id, title: 'Archived meeting', start: 0, excerpt: 'Corrected words' }])
    run("INSERT INTO assistant_conversations(id,title,created_at,updated_at,version) VALUES ('chat','Planning discussion',?,?,1)", [date, date])
    run("INSERT INTO assistant_messages VALUES ('question','chat',0,'user','What changed?','[]',?)", [date])
    run("INSERT INTO assistant_messages VALUES ('answer','chat',1,'assistant','The words were corrected. [1]',?,?)", [citations, date])
    run("INSERT INTO calendar_sources(id,name,feed_hash,ciphertext,created_at) VALUES ('calendar','Work','hash',?,?)", [Buffer.from('encrypted-private-link'), date])
    run("INSERT INTO calendar_events(id,source_id,event_key,title,description,location,start,end) VALUES ('event','calendar','key','Planning','Agenda','Office',?,?)", [date, date])
    run("INSERT INTO recording_calendar VALUES (?,'event')", [id])
    run("INSERT OR REPLACE INTO settings VALUES ('semantic-enabled','true')")
    await backups.create(archive)
    run("DELETE FROM assistant_conversations")
    const preview = await restore.prepare(archive)
    expect(preview!.counts).toMatchObject({ assistant_conversations: 1, assistant_messages: 2, calendar_sources: 1, calendar_events: 1, recording_calendar: 1 })
    await restore.schedule(preview!.id); closeDatabase(); expect(applyPendingRestore(data)).toBe(true)
    initializeDatabase(join(data, 'data', 'library.db'))
    expect(queryOne('SELECT title,version FROM assistant_conversations')).toEqual({ title: 'Planning discussion', version: 1 })
    expect(queryOne('SELECT content,citations FROM assistant_messages WHERE role=\'assistant\'')).toEqual({ content: 'The words were corrected. [1]', citations })
    expect(queryOne('SELECT ciphertext FROM calendar_sources')).toEqual({ ciphertext: null })
    expect(queryOne('SELECT event_id FROM recording_calendar WHERE recording_id=?', [id])).toEqual({ event_id: 'event' })
    expect(queryOne("SELECT value FROM settings WHERE key='semantic-enabled'")).toEqual({ value: 'false' })
  })
  it('restores a schema 11 library without requiring chat, search, or calendar tables', async () => {
    removeSchema12(); getDatabase().pragma('user_version = 11')
    await backups.create(archive)
    const preview = await restore.prepare(archive)
    await restore.schedule(preview!.id); closeDatabase(); applyPendingRestore(data)
    initializeDatabase(join(data, 'data', 'library.db'))
    expect(getDetail(id).segments[0].text).toBe('Corrected words')
    expect(queryOne('SELECT count(*) AS count FROM assistant_conversations')).toEqual({ count: 0 })
    expect(getDatabase().pragma('user_version', { simple: true })).toBe(DATABASE_SCHEMA_VERSION)
  })
  it('rejects an unknown trigger even when the archive and database hashes are otherwise valid', async () => {
    getDatabase().exec("CREATE TRIGGER unexpected_update AFTER UPDATE ON recordings BEGIN DELETE FROM actionables; END")
    await backups.create(archive)
    await expect(restore.prepare(archive)).rejects.toThrow('schema is not recognized')
    expect(getDetail(id).actionables[0].done).toBe(true)
    expect(existsSync(join(data, 'data', 'restore-pending.json'))).toBe(false)
  })
})
