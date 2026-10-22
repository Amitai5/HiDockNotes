import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDatabase, getDatabase, initializeDatabase, listActionables, queryOne, run, upsertRecordingFromDevice, DATABASE_SCHEMA_VERSION } from '../database'
import { removeSchema12 } from './schema-fixtures'

let folder: string | undefined
afterEach(() => { closeDatabase(); if (folder) { rmSync(folder, { recursive: true, force: true }); folder = undefined } })
describe('existing action item migration', () => {
  it('upgrades a version 5 database without losing checked tasks or inventing dates', () => {
    folder = mkdtempSync(join(tmpdir(), 'hidocknotes-migration-'))
    const file = join(folder, 'library.db')
    initializeDatabase(file)
    const recording = upsertRecordingFromDevice({ filename: 'old.hda', size: 100, duration: 10, dateCreated: new Date('2026-10-07T10:00:00Z') })
    run('INSERT INTO actionables(id,recording_id,text,done,start) VALUES (?, ?, ?, 1, 2)', ['legacy', recording.id, 'Already completed'])
    removeSchema12()
    getDatabase().exec('DROP TABLE transcript_revisions; DROP TABLE transcript_candidates; DROP TABLE transcript_corrections; DROP TABLE transcript_artifacts; DROP TABLE recording_deletions; DROP TABLE recording_tags; DROP TABLE recording_overviews; ALTER TABLE transcription_jobs DROP COLUMN mode; ALTER TABLE transcription_jobs DROP COLUMN generation; ALTER TABLE actionables DROP COLUMN owner; DROP INDEX actionables_open_due; ALTER TABLE actionables DROP COLUMN created_at; ALTER TABLE actionables DROP COLUMN due_date; ALTER TABLE actionables DROP COLUMN completed_at; PRAGMA user_version=5;')
    closeDatabase()
    initializeDatabase(file)
    expect(getDatabase().pragma('user_version', { simple: true })).toBe(DATABASE_SCHEMA_VERSION)
    expect(listActionables()).toEqual([{ id: 'legacy', recordingId: recording.id, text: 'Already completed', done: true, start: 2, owner: null, createdAt: null, dueDate: null, completedAt: null }])
  })
  it('backfills existing outcome sections without rewriting notes or inventing transcript evidence', () => {
    folder = mkdtempSync(join(tmpdir(), 'hidocknotes-outcomes-migration-'))
    const file = join(folder, 'library.db')
    initializeDatabase(file)
    const recording = upsertRecordingFromDevice({ filename: 'old.hda', size: 100, duration: 10, dateCreated: new Date('2026-10-07T10:00:00Z') })
    const text = 'Purpose.\n\n## Decisions\n- The pilot is approved.\n\n## Open questions\nNone recorded.\n\n## Risks / blockers\n- Vendor delay.\n\n## Next steps\n- Meet Friday.'
    run('INSERT INTO summaries(id,recording_id,text) VALUES (?,?,?)', ['old-summary', recording.id, text])
    getDatabase().exec('ALTER TABLE summaries DROP COLUMN outcomes; PRAGMA user_version=12')
    closeDatabase(); initializeDatabase(file)
    const saved = queryOne<{ text: string; outcomes: string }>('SELECT text,outcomes FROM summaries WHERE recording_id=?', [recording.id])!
    expect(saved.text).toBe(text)
    expect(JSON.parse(saved.outcomes)).toMatchObject([{ kind: 'decision', source: 'summary', start: null, evidence: null }, { kind: 'risk' }, { kind: 'next_step' }])
    closeDatabase(); initializeDatabase(file)
    expect(queryOne('SELECT text,outcomes FROM summaries WHERE recording_id=?', [recording.id])).toEqual(saved)
  })
})
