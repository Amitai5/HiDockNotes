import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { closeDatabase, getDatabase, initializeDatabase, run, saveSettings, upsertRecordingFromDevice } from '../database'
import { LibraryBackupService } from '../library-backup'
import { tarHeader, tarFile, type ArchivedFile } from '../backup-archive'

let root: string, dataPath: string, external: string, target: string, service: LibraryBackupService
const date = '2026-10-13T10:00:00.000Z'
const audio = Buffer.from('original audio bytes'), embedding = Buffer.from([0, 0, 128, 63])
const sha = (value: Buffer): string => createHash('sha256').update(value).digest('hex')
function entries(archive: Buffer): Map<string, Buffer> {
  const bytes = gunzipSync(archive), result = new Map<string, Buffer>()
  for (let offset = 0; offset + 512 <= bytes.length && bytes[offset];) {
    const header = bytes.subarray(offset, offset + 512)
    const name = header.subarray(0, 100).toString().split('\0')[0]
    const size = parseInt(header.subarray(124, 136).toString(), 8)
    const expected = parseInt(header.subarray(148, 156).toString(), 8)
    const checksumHeader = Buffer.from(header); checksumHeader.fill(32, 148, 156)
    expect(checksumHeader.reduce((sum, byte) => sum + byte, 0)).toBe(expected)
    expect(header.subarray(257, 263).toString()).toBe('ustar\0')
    result.set(name, bytes.subarray(offset + 512, offset + 512 + size))
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return result
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'hidocknotes-backup-test-'))
  dataPath = join(root, 'app'); external = join(root, 'custom-audio'); target = join(root, 'complete.tar.gz')
  await mkdir(join(dataPath, 'data'), { recursive: true }); await mkdir(external)
  initializeDatabase(':memory:')
  service = new LibraryBackupService({ database: getDatabase, dataPath, version: '0.9.0', changed: () => undefined, now: () => new Date(date) })
})
afterEach(async () => { await service.stop(); closeDatabase(); await rm(root, { recursive: true, force: true }) })
async function fixture(): Promise<string> {
  const row = upsertRecordingFromDevice({ filename: 'call.hda', size: audio.length, duration: 20, dateCreated: new Date(date) })
  const file = join(external, 'renamed.wav'); await writeFile(file, audio)
  run("UPDATE recordings SET file_path=?,checksum=?,verified=1,title='Planning',status='done' WHERE id=?", [file, sha(audio), row.id])
  saveSettings({ name: 'Dana', recordingsPath: external })
  run("INSERT INTO projects VALUES ('project','Launch',?)", [date]); run("UPDATE recordings SET project_id='project' WHERE id=?", [row.id])
  run("INSERT INTO voice_profiles VALUES ('voice','Dana',?)", [date])
  run("INSERT INTO speakers(id,recording_id,label,voice_profile_id,embedding,label_source) VALUES ('speaker',?,'Dana','voice',?,'manual')", [row.id, embedding])
  run("INSERT INTO voice_samples(id,voice_profile_id,embedding,source_recording,created_at,speaker_id) VALUES ('sample','voice',?,?,?,'speaker')", [embedding, row.id, date])
  run("INSERT INTO transcripts(id,recording_id,text,provider,model) VALUES ('transcript',?,'Approved the plan.','local','whisper-base')", [row.id])
  run("INSERT INTO segments VALUES ('segment',?,1,3,'Approved the plan.','speaker')", [row.id])
  run("INSERT INTO summaries(id,recording_id,text) VALUES ('summary',?,'## Decisions\nThe plan is approved.')", [row.id])
  run("INSERT INTO actionables(id,recording_id,text,done,created_at,due_date,completed_at,owner) VALUES ('task',?,'Send the plan',1,?,'2026-10-14',?,'Dana')", [row.id, date, date])
  run("INSERT INTO recording_tags(recording_id,tag) VALUES (?,'planning')", [row.id])
  run("INSERT INTO recording_overviews(recording_id,meeting_type,participants,expected_speakers) VALUES (?,'Project review','[]',2)", [row.id])
  run("INSERT INTO provider_credentials VALUES ('gemini',?,?, '[]')", [Buffer.from('encrypted-credential-bytes'), date])
  run("INSERT INTO chatgpt_profiles(id,label,client_id,issuer,subject,ciphertext,created_at) VALUES ('account','Account','client','issuer','subject',?,?)", [Buffer.from('encrypted-session-bytes'), date])
  run('INSERT INTO synced_files VALUES (?,?,?,?,?)', ['call.hda', 'renamed.wav', file, audio.length, date])
  return row.id
}
describe('complete library backups', () => {
  it('archives all SQLite metadata and custom-folder audio with checksums, without duplicating synced audio', async () => {
    const id = await fixture()
    await writeFile(join(dataPath, 'data', 'agent-connection.bin'), Buffer.from('encrypted-agent-connection'))
    const result = await service.create(target)
    expect(result).toMatchObject({ filePath: target, recordings: 1, changedAudio: 0 })
    const files = entries(await readFile(target)), manifest = JSON.parse(files.get('manifest.json')!.toString())
    expect(manifest).toMatchObject({ formatVersion: 1, appVersion: '0.9.0', databaseSchema: 10, createdAt: date, counts: { recordings: 1, transcripts: 1, segments: 1, speakers: 1, voice_profiles: 1, voice_samples: 1, actionables: 1, recording_tags: 1, projects: 1 } })
    expect(manifest.recordings.find((row: { recordingId: string }) => row.recordingId === id)).toMatchObject({ originalPath: join(external, 'renamed.wav'), archivePath: 'recordings/audio-1.wav', expectedSha256: sha(audio) })
    expect(files.get('recordings/audio-1.wav')).toEqual(audio)
    expect(Array.from(files.keys()).filter(name => name.startsWith('recordings/'))).toHaveLength(1)
    for (const file of manifest.files) expect(sha(files.get(file.path)!)).toBe(file.sha256)
    const saved = join(root, 'restored.db'); await writeFile(saved, files.get('data/library.db')!)
    const copy = new Database(saved, { readonly: true })
    try {
      expect(copy.pragma('integrity_check', { simple: true })).toBe('ok')
      expect(copy.prepare('SELECT * FROM actionables').get()).toMatchObject({ done: 1, owner: 'Dana', due_date: '2026-10-14', created_at: date, completed_at: date })
      expect(copy.prepare('SELECT embedding FROM voice_samples').get()).toEqual({ embedding })
      expect(copy.prepare('SELECT ciphertext FROM provider_credentials').get()).toEqual({ ciphertext: Buffer.from('encrypted-credential-bytes') })
      expect(copy.prepare('SELECT ciphertext FROM chatgpt_profiles').get()).toEqual({ ciphertext: Buffer.from('encrypted-session-bytes') })
      expect(copy.prepare('SELECT transcript FROM recording_fts').get()).toEqual({ transcript: 'Approved the plan.' })
    } finally { copy.close() }
    expect((await readdir(root)).some(name => name.includes('.partial') || name.startsWith('.HiDockNotes-backup-'))).toBe(false)
  })
  it('uses the completed snapshot for its audio roster even when the live database changes afterwards', async () => {
    await fixture()
    service = new LibraryBackupService({ database: getDatabase, dataPath, version: '0.9.0', now: () => new Date(date), changed: state => { if (state.phase === 'archiving') run("INSERT OR IGNORE INTO projects VALUES ('later','New project',?)", [date]) } })
    await service.create(target)
    const manifest = JSON.parse(entries(await readFile(target)).get('manifest.json')!.toString())
    expect(manifest.counts.projects).toBe(1)
    expect(getDatabase().prepare('SELECT count(*) AS count FROM projects').get()).toEqual({ count: 2 })
  })
  it('fails on missing audio and keeps an existing backup intact with no incomplete files', async () => {
    await fixture(); await rm(join(external, 'renamed.wav')); await writeFile(target, 'previous backup')
    await expect(service.create(target)).rejects.toThrow('Cannot read saved audio')
    expect(await readFile(target, 'utf8')).toBe('previous backup')
    expect(service.state().phase).toBe('failed')
    expect((await readdir(root)).filter(name => name.includes('.partial') || name.startsWith('.HiDockNotes-backup-'))).toEqual([])
  })
  it('cancels safely without replacing a previous archive and refuses overlapping operations', async () => {
    await fixture(); await writeFile(target, 'previous backup')
    service = new LibraryBackupService({ database: getDatabase, dataPath, version: '0.9.0', changed: state => { if (state.phase === 'archiving') service.cancel() } })
    const task = service.create(target)
    await expect(service.create(target)).rejects.toThrow('already running')
    expect(await task).toBeNull()
    expect(service.state().phase).toBe('cancelled')
    expect(await readFile(target, 'utf8')).toBe('previous backup')
    expect((await readdir(root)).filter(name => name.includes('.partial') || name.startsWith('.HiDockNotes-backup-'))).toEqual([])
  })
  it('captures changed original bytes rather than discarding them, and records an integrity warning', async () => {
    await fixture(); await writeFile(join(external, 'renamed.wav'), 'changed bytes')
    expect(await service.create(target)).toMatchObject({ changedAudio: 1 })
    const files = entries(await readFile(target)), manifest = JSON.parse(files.get('manifest.json')!.toString())
    expect(manifest.changedAudio).toBe(1)
    expect(files.get('recordings/audio-1.wav')!.toString()).toBe('changed bytes')
  })
  it('rejects unsafe destinations and includes device-only metadata without inventing missing audio', async () => {
    await expect(service.create(join(dataPath, 'data', 'library.tar.gz'))).rejects.toThrow('outside the application')
    await expect(service.create(join(root, 'library.db'))).rejects.toThrow('.tar.gz')
    upsertRecordingFromDevice({ filename: 'device-only.hda', size: 200, duration: 10, dateCreated: new Date(date) })
    await service.create(target)
    const manifest = JSON.parse(entries(await readFile(target)).get('manifest.json')!.toString())
    expect(manifest.counts.recordings).toBe(1)
    expect(manifest.recordings[0].archivePath).toBeNull()
    expect(service.state().recordings).toBe(0)
  })
})
describe('portable archive safeguards', () => {
  it.each(['../data/library.db', '/absolute', 'recordings/./audio', 'data\\library.db', 'A'.repeat(100)])('rejects unsafe archive names: %s', name => { expect(() => tarHeader(name, 1)).toThrow() })
  it('rejects invalid and oversized individual entries', () => { for (const size of [-1, NaN, 0o100000000000]) expect(() => tarHeader('data/library.db', size)).toThrow() })
  it('detects a source changing while streamed and does not report it as archived', async () => {
    const source = join(external, 'large.wav'); await writeFile(source, Buffer.alloc(600000))
    const files: ArchivedFile[] = [], iterator = tarFile(source, 'recordings/audio.wav', files, new AbortController().signal, () => undefined)
    await iterator.next(); await iterator.next()
    await writeFile(source, Buffer.from('truncated'))
    await expect(iterator.next()).rejects.toThrow('changed while')
    expect(files).toEqual([])
  })
})
