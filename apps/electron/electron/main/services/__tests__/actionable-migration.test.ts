import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDatabase, getDatabase, initializeDatabase, listActionables, run, upsertRecordingFromDevice } from '../database'

let folder: string | undefined
afterEach(() => { closeDatabase(); if (folder) { rmSync(folder, { recursive: true, force: true }); folder = undefined } })
describe('existing action item migration', () => {
  it('upgrades a version 5 database without losing checked tasks or inventing dates', () => {
    folder = mkdtempSync(join(tmpdir(), 'hidocknotes-migration-'))
    const file = join(folder, 'library.db')
    initializeDatabase(file)
    const recording = upsertRecordingFromDevice({ filename: 'old.hda', size: 100, duration: 10, dateCreated: new Date('2026-10-07T10:00:00Z') })
    run('INSERT INTO actionables(id,recording_id,text,done,start) VALUES (?, ?, ?, 1, 2)', ['legacy', recording.id, 'Already completed'])
    getDatabase().exec('DROP TABLE transcript_artifacts; DROP TABLE recording_deletions; DROP TABLE recording_tags; DROP TABLE recording_overviews; ALTER TABLE transcription_jobs DROP COLUMN mode; ALTER TABLE transcription_jobs DROP COLUMN generation; ALTER TABLE actionables DROP COLUMN owner; DROP INDEX actionables_open_due; ALTER TABLE actionables DROP COLUMN created_at; ALTER TABLE actionables DROP COLUMN due_date; ALTER TABLE actionables DROP COLUMN completed_at; PRAGMA user_version=5;')
    closeDatabase()
    initializeDatabase(file)
    expect(getDatabase().pragma('user_version', { simple: true })).toBe(10)
    expect(listActionables()).toEqual([{ id: 'legacy', recordingId: recording.id, text: 'Already completed', done: true, start: 2, owner: null, createdAt: null, dueDate: null, completedAt: null }])
  })
})
