import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, initializeDatabase, getDatabase, queryOne, run, upsertRecordingFromDevice, listRecordings, getSettings, saveSettings, createProject, renameRecording } from '../database'

describe('recording database', () => {
  beforeEach(() => initializeDatabase(':memory:'))
  afterEach(closeDatabase)
  it('applies versioned migrations and enables foreign keys', () => {
    expect(getDatabase().pragma('user_version', { simple: true })).toBe(5)
    expect(getDatabase().pragma('foreign_keys', { simple: true })).toBe(1)
    expect(queryOne('SELECT name FROM sqlite_master WHERE name=?', ['voice_samples'])).toBeDefined()
  })
  it('upserts discovery without creating duplicate recordings', () => {
    const file = { filename: '2026Oct07-100000-Rec01.hda', size: 200, duration: 10, dateCreated: new Date('2026-10-07T10:00:00Z') }
    const first = upsertRecordingFromDevice(file)
    const second = upsertRecordingFromDevice({ ...file, size: 300 })
    expect(second.id).toBe(first.id)
    expect(listRecordings()).toHaveLength(1)
    expect(second.file_size).toBe(300)
  })
  it('searches transcript, title and summary through FTS5', () => {
    const recording = upsertRecordingFromDevice({ filename: 'call.hda', size: 200, duration: 10, dateCreated: new Date('2026-10-07T10:00:00Z') })
    run('INSERT INTO transcripts(id, recording_id, text) VALUES (?, ?, ?)', ['transcript', recording.id, 'Budget discussion with Dana'])
    run('INSERT INTO summaries(id, recording_id, text) VALUES (?, ?, ?)', ['summary', recording.id, 'Approve next quarter spending'])
    expect(listRecordings('budget')[0]?.id).toBe(recording.id)
    expect(listRecordings('quarter')[0]?.id).toBe(recording.id)
    expect(listRecordings('missing')).toEqual([])
    expect(() => listRecordings('" OR *')).not.toThrow()
  })
  it('preserves settings and project membership', () => {
    saveSettings({ name: 'Dana', autoDownload: false })
    expect(getSettings('/recordings')).toMatchObject({ name: 'Dana', autoDownload: false, recordingsPath: '/recordings' })
    const project = createProject('Product interviews')
    expect(project).toMatchObject({ name: 'Product interviews', count: 0 })
  })
  it('reads only app settings when subscription registrations store separate plain-text identifiers', () => {
    saveSettings({ name: 'Dana', appearance: 'dark' })
    run("INSERT INTO settings(key,value) VALUES ('chatgpt-host-id','urn:uuid:account-host'),('chatgpt-active-profile','profile-id')")
    expect(getSettings('/recordings')).toMatchObject({ name: 'Dana', appearance: 'dark', recordingsPath: '/recordings' })
    expect(queryOne<{ value: string }>("SELECT value FROM settings WHERE key='chatgpt-host-id'")?.value).toBe('urn:uuid:account-host')
  })
  it('rolls back a failed transaction', () => {
    expect(() => getDatabase().transaction(() => { createProject('Keep atomic'); throw new Error('rollback') })()).toThrow('rollback')
    expect(queryOne('SELECT id FROM projects')).toBeUndefined()
  })
  it('renames the display title and FTS without changing the device identity or saved path', () => {
    const recording = upsertRecordingFromDevice({ filename: 'call.hda', size: 200, duration: 10, dateCreated: new Date('2026-10-07T10:00:00Z') })
    run('UPDATE recordings SET file_path=?, checksum=?, verified=1 WHERE id=?', ['/saved/call.wav', 'checksum', recording.id])
    renameRecording(recording.id, 'Planning with Dana')
    expect(listRecordings('Planning')[0]?.title).toBe('Planning with Dana')
    expect(queryOne('SELECT filename, file_path, checksum, verified, title_source FROM recordings WHERE id=?', [recording.id])).toEqual({ filename: 'call.hda', file_path: '/saved/call.wav', checksum: 'checksum', verified: 1, title_source: 'manual' })
    expect(() => renameRecording(recording.id, ' ')).toThrow()
  })
})
