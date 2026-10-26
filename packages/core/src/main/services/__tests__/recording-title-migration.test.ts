import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backupBeforeDatabaseMigration, closeDatabase, createProject, DATABASE_SCHEMA_VERSION, getDatabase, initializeDatabase, listRecordings, queryAll, queryOne, renameRecording, run, upsertRecordingFromDevice, validateDatabaseSchema } from '../database'
import { WrittenNotes } from '../written-notes'

let folder: string, file: string, counter: number
const date = '2026-10-08T20:10:00.000Z'
const originalTitle = 'HubSpot Intake Workflow and Form Design Review'
const shortTitle = 'HubSpot Intake Workflow and Form Design'

function recording(title: string | null, source: string | null): string {
  const row = upsertRecordingFromDevice({ filename: `recording-${++counter}.hda`, size: 200, duration: 20, dateCreated: new Date(date) })
  run('UPDATE recordings SET title=?,title_source=? WHERE id=?', [title, source, row.id])
  return row.id
}

function closeAsPreviousVersion(): void {
  getDatabase().pragma('user_version=15')
  closeDatabase()
}

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'hidocknotes-title-upgrade-'))
  file = join(folder, 'library.db'); counter = 0
  initializeDatabase(file)
})
afterEach(() => { closeDatabase(); rmSync(folder, { recursive: true, force: true }) })

describe('existing AI recording title upgrade', () => {
  it('shortens AI titles and search atomically without changing audio identity, stored content, or jobs', () => {
    const id = recording(originalTitle, 'ai'), project = createProject('ColonyLaw')
    run("UPDATE recordings SET file_path='/saved/original.wav',checksum='checksum',verified=1,status='done',project_id=? WHERE id=?", [project.id, id])
    run("INSERT INTO transcripts(id,recording_id,text,provider,model) VALUES ('transcript',?,'Exact saved transcript','local','whisper-small')", [id])
    run("INSERT INTO segments(id,recording_id,start,end,text) VALUES ('segment',?,0,10,'Exact saved transcript')", [id])
    run("INSERT INTO summaries(id,recording_id,text) VALUES ('summary',?,'Saved summary remains identical')", [id])
    run("INSERT INTO transcription_jobs(id,recording_id,stage,created_at,mode,progress) VALUES ('job',?,'done',?,'summary',1)", [id, date])
    run("INSERT INTO recording_overviews(recording_id,expected_speakers) VALUES (?,3)", [id])
    run("INSERT INTO actionables(id,recording_id,text,done) VALUES ('action',?,'Edited completed task',1)", [id])
    run("INSERT INTO semantic_documents(recording_id,fingerprint,model,indexed_at) VALUES (?,'old-fingerprint','local',?)", [id, date])
    const before = queryOne<Record<string, unknown>>('SELECT * FROM recordings WHERE id=?', [id])
    const tables = ['transcripts', 'segments', 'summaries', 'transcription_jobs', 'recording_overviews', 'actionables', 'projects']
    const content = tables.map(table => queryAll(`SELECT * FROM ${table}`))
    closeAsPreviousVersion()

    initializeDatabase(file)

    expect(queryOne('SELECT * FROM recordings WHERE id=?', [id])).toEqual({ ...before, title: shortTitle })
    expect(tables.map(table => queryAll(`SELECT * FROM ${table}`))).toEqual(content)
    expect(listRecordings('HubSpot')[0]?.title).toBe(shortTitle)
    expect(listRecordings('Review')).toEqual([])
    expect(queryOne('SELECT title FROM recording_fts WHERE recording_id=?', [id])).toEqual({ title: shortTitle })
    expect(queryOne('SELECT recording_id FROM semantic_documents WHERE recording_id=?', [id])).toBeUndefined()
    expect(getDatabase().pragma('user_version', { simple: true })).toBe(DATABASE_SCHEMA_VERSION)
    expect(() => validateDatabaseSchema(getDatabase())).not.toThrow()
  })

  it('keeps manual, unknown, legacy, empty and already concise titles and written notes unchanged', () => {
    const manual = recording(originalTitle, 'ai'); renameRecording(manual, originalTitle)
    recording(originalTitle, null); recording(originalTitle, 'legacy'); recording(null, 'ai'); recording('  ', 'ai')
    const concise = recording('Intake Workflow Review', 'ai')
    new WrittenNotes({ changed: () => undefined }).create({ requestId: '00000000-0000-4000-8000-000000000001', projectId: null, title: originalTitle })
    const rows = queryAll('SELECT * FROM recordings'), notes = queryAll('SELECT * FROM written_notes')
    run("INSERT INTO semantic_documents(recording_id,fingerprint,model,indexed_at) VALUES (?,'keep-fingerprint','local',?)", [concise, date])
    closeAsPreviousVersion()

    initializeDatabase(file)

    expect(queryAll('SELECT * FROM recordings')).toEqual(rows)
    expect(queryAll('SELECT * FROM written_notes')).toEqual(notes)
    expect(queryOne('SELECT fingerprint FROM semantic_documents WHERE recording_id=?', [concise])).toEqual({ fingerprint: 'keep-fingerprint' })
  })

  it('keeps the original title in the automatic recovery copy and validates both database versions', async () => {
    const id = recording(originalTitle, 'ai'); closeAsPreviousVersion()
    await backupBeforeDatabaseMigration(file)
    const backups = readdirSync(folder).filter(name => name.startsWith(`library.db.before-schema-${DATABASE_SCHEMA_VERSION}-`) && name.endsWith('.db'))
    expect(backups).toHaveLength(1)

    initializeDatabase(file)

    expect(queryOne('SELECT title FROM recordings WHERE id=?', [id])).toEqual({ title: shortTitle })
    const previous = new Database(join(folder, backups[0]), { readonly: true })
    try {
      expect(previous.prepare('SELECT title FROM recordings WHERE id=?').get(id)).toEqual({ title: originalTitle })
      expect(previous.pragma('user_version', { simple: true })).toBe(15)
      expect(() => validateDatabaseSchema(previous)).not.toThrow()
    } finally { previous.close() }
    closeDatabase(); await backupBeforeDatabaseMigration(file)
    expect(readdirSync(folder).filter(name => name.startsWith('library.db.before-schema-') && name.endsWith('.db'))).toHaveLength(1)
  })

  it('does not rerun on restart or overwrite a later manual edit', () => {
    const id = recording(originalTitle, 'ai'); closeAsPreviousVersion(); initializeDatabase(file)
    renameRecording(id, 'My deliberately longer title for this recording that must stay')
    const later = recording('Another newly saved long generated title that must not rerun the migration', 'ai')
    closeDatabase()

    initializeDatabase(file)

    expect(queryOne('SELECT title,title_source FROM recordings WHERE id=?', [id])).toEqual({ title: 'My deliberately longer title for this recording that must stay', title_source: 'manual' })
    expect(queryOne('SELECT title FROM recordings WHERE id=?', [later])).toEqual({ title: 'Another newly saved long generated title that must not rerun the migration' })
    expect(queryOne('SELECT total_changes() AS count')).toEqual({ count: 0 })
  })

  it('rolls back every title and the migration version if an update fails, then retries cleanly', () => {
    recording(originalTitle, 'ai'); const failed = recording('Another detailed recording title containing far too many words', 'ai')
    getDatabase().exec(`CREATE TRIGGER reject_title_upgrade BEFORE UPDATE OF title ON recordings WHEN old.id='${failed}' BEGIN SELECT RAISE(ABORT,'fixture write failed'); END;`)
    const rows = queryAll('SELECT * FROM recordings'), index = queryAll('SELECT * FROM recording_fts')
    closeAsPreviousVersion()

    expect(() => initializeDatabase(file)).toThrow('fixture write failed')

    expect(queryAll('SELECT * FROM recordings')).toEqual(rows)
    expect(queryAll('SELECT * FROM recording_fts')).toEqual(index)
    expect(getDatabase().pragma('user_version', { simple: true })).toBe(15)
    getDatabase().exec('DROP TRIGGER reject_title_upgrade'); closeDatabase(); initializeDatabase(file)
    expect(listRecordings().find(row => row.id !== failed)?.title).toBe(shortTitle)
    expect(getDatabase().pragma('user_version', { simple: true })).toBe(DATABASE_SCHEMA_VERSION)
  })
})
