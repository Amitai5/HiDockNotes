import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backupBeforeDatabaseMigration, closeDatabase, DATABASE_SCHEMA_VERSION, getDatabase, initializeDatabase, queryAll, queryOne, renameRecording, run, upsertRecordingFromDevice, validateDatabaseSchema } from '../database'
import { saveProcessingResult } from '../../ai/processing-store'
import { DEFAULT_AI_SETTINGS } from '../../../../src/shared/ai'

let folder: string, file: string, counter: number
const date = '2026-10-26T10:00:00.000Z'
function recording(title: string, source: string | null, origin: 'upload' | 'capture' | 'none' = 'upload', state = 'completed') {
  const key = 'origin-' + ++counter, row = upsertRecordingFromDevice({ filename: key + '.wav', size: 200, duration: 10, dateCreated: new Date(date) })
  run('UPDATE recordings SET title=?,title_source=?,file_path=?,checksum=?,verified=1 WHERE id=?', [title, source, '/saved/' + key + '.wav', 'a'.repeat(64), row.id])
  if (origin === 'upload') run('INSERT INTO server_uploads(id,filename,size,offset,checksum,recorded_at,state,recording_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)', [key, 'original.wav', 200, 200, 'a'.repeat(64), date, state, row.id, 1])
  if (origin === 'capture') run('INSERT INTO server_captures(id,serial,created_at,state,recording_id) VALUES (?,?,?,?,?)', [key, 'fixture-recorder', date, state, row.id])
  return row.id
}
function previous() { getDatabase().pragma('user_version=16'); closeDatabase() }
beforeEach(() => { folder = mkdtempSync(join(tmpdir(), 'hidock-placeholder-upgrade-')); file = join(folder, 'library.db'); counter = 0; initializeDatabase(file) })
afterEach(() => { closeDatabase(); rmSync(folder, { recursive: true, force: true }) })

describe('restoring automatic recording title provenance', () => {
  it('makes a legacy uploaded filename eligible for the next summary without changing content or starting jobs', () => {
    const id = recording('original.wav', 'manual'), before = queryOne<Record<string, unknown>>('SELECT * FROM recordings WHERE id=?', [id])
    run("INSERT INTO transcripts(id,recording_id,text,provider,model) VALUES ('transcript',?,'Saved exact words','local','whisper-small')", [id])
    run("INSERT INTO segments(id,recording_id,start,end,text) VALUES ('segment',?,0,1,'Saved exact words')", [id])
    run("INSERT INTO summaries(id,recording_id,text) VALUES ('summary',?,'Last good summary')", [id])
    run("INSERT INTO semantic_documents(recording_id,fingerprint,model,indexed_at) VALUES (?,'keep-index','local',?)", [id, date])
    const tables = ['transcripts', 'segments', 'summaries', 'server_uploads', 'semantic_documents', 'recording_fts'], content = tables.map(table => queryAll('SELECT * FROM ' + table))
    previous(); initializeDatabase(file)

    expect(queryOne('SELECT * FROM recordings WHERE id=?', [id])).toEqual({ ...before, title_source: 'placeholder' })
    expect(tables.map(table => queryAll('SELECT * FROM ' + table))).toEqual(content)
    expect(queryAll('SELECT * FROM transcription_jobs')).toEqual([])
    expect(() => validateDatabaseSchema(getDatabase())).not.toThrow()
    saveProcessingResult(id, { duration: 10, speakers: [], segments: [], transcriptChanged: false, empty: false, summary: { title: 'Launch Review', summary: 'Updated summary', actionItems: [] } }, DEFAULT_AI_SETTINGS)
    expect(queryOne('SELECT title,title_source FROM recordings WHERE id=?', [id])).toEqual({ title: 'Launch Review', title_source: 'ai' })
    expect(queryOne('SELECT text FROM transcripts WHERE recording_id=?', [id])).toEqual({ text: 'Saved exact words' })
  })
  it('keeps custom, AI, unknown, unlinked and unfinished-upload titles protected', () => {
    recording('My custom name', 'manual'); recording('original.wav', 'ai'); recording('original.wav', 'legacy'); recording('original.wav', 'manual', 'none'); recording('original.wav', 'manual', 'upload', 'uploading')
    const before = queryAll('SELECT * FROM recordings')
    previous(); initializeDatabase(file)
    expect(queryAll('SELECT * FROM recordings')).toEqual(before)
  })
  it('recognizes only linked automatic capture labels with no manual provenance', () => {
    const live = recording('Live recording ' + date, null, 'capture'), interrupted = recording('Interrupted capture ' + date, null, 'capture')
    const manual = recording('Live recording ' + date, 'manual', 'capture'), custom = recording('My capture', null, 'capture'), unlinked = recording('Live recording ' + date, null, 'none')
    previous(); initializeDatabase(file)
    for (const id of [live, interrupted]) expect(queryOne('SELECT title_source FROM recordings WHERE id=?', [id])).toEqual({ title_source: 'placeholder' })
    for (const id of [manual, custom, unlinked]) expect(queryOne('SELECT title_source FROM recordings WHERE id=?', [id])).toEqual({ title_source: id === manual ? 'manual' : null })
  })
  it('does not reclassify a later deliberate filename edit on restart', () => {
    const id = recording('original.wav', 'manual'); previous(); initializeDatabase(file)
    renameRecording(id, 'original.wav'); closeDatabase(); initializeDatabase(file)
    expect(queryOne('SELECT title,title_source FROM recordings WHERE id=?', [id])).toEqual({ title: 'original.wav', title_source: 'manual' })
    expect(queryOne('SELECT total_changes() AS count')).toEqual({ count: 0 })
  })
  it('keeps the original provenance in a schema-16 recovery copy', async () => {
    const id = recording('original.wav', 'manual'); previous(); await backupBeforeDatabaseMigration(file)
    const backups = readdirSync(folder).filter(name => name.startsWith('library.db.before-schema-' + DATABASE_SCHEMA_VERSION + '-') && name.endsWith('.db'))
    expect(backups).toHaveLength(1); initializeDatabase(file)
    const old = new Database(join(folder, backups[0]), { readonly: true })
    try { expect(old.pragma('user_version', { simple: true })).toBe(16); expect(old.prepare('SELECT title_source FROM recordings WHERE id=?').get(id)).toEqual({ title_source: 'manual' }); expect(() => validateDatabaseSchema(old)).not.toThrow() } finally { old.close() }
    expect(queryOne('SELECT title_source FROM recordings WHERE id=?', [id])).toEqual({ title_source: 'placeholder' })
  })
  it('rolls back the complete provenance repair and version on a failed write', () => {
    recording('original.wav', 'manual'); const second = recording('original.wav', 'manual')
    getDatabase().exec('CREATE TRIGGER reject_placeholder BEFORE UPDATE OF title_source ON recordings WHEN old.id=' + "'" + second + "'" + " BEGIN SELECT RAISE(ABORT,'fixture write failed'); END;")
    previous()
    expect(() => initializeDatabase(file)).toThrow('fixture write failed')
    expect(queryAll('SELECT title_source FROM recordings')).toEqual([{ title_source: 'manual' }, { title_source: 'manual' }])
    expect(getDatabase().pragma('user_version', { simple: true })).toBe(16)
    getDatabase().exec('DROP TRIGGER reject_placeholder'); closeDatabase(); initializeDatabase(file)
    expect(queryAll('SELECT title_source FROM recordings')).toEqual([{ title_source: 'placeholder' }, { title_source: 'placeholder' }])
    expect(getDatabase().pragma('user_version', { simple: true })).toBe(DATABASE_SCHEMA_VERSION)
  })
})
