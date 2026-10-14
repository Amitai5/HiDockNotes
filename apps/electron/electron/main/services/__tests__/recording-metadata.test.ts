import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, createProject, getDetail, initializeDatabase, libraryNavigation, queryOne, run, upsertRecordingFromDevice } from '../database'
import { assignRecordingProject, setRecordingTags } from '../recording-metadata'

let id: string
beforeEach(() => {
  initializeDatabase(':memory:')
  id = upsertRecordingFromDevice({ filename: 'original.hda', duration: 60, size: 100, dateCreated: new Date('2026-10-07T10:00:00Z') }).id
  run('UPDATE recordings SET file_path=?,checksum=?,verified=1 WHERE id=?', ['/saved/original.hda', 'verified-checksum', id])
})
afterEach(closeDatabase)
describe('recording metadata', () => {
  it('saves, normalizes, replaces, and clears tags without changing the recording identity', () => {
    setRecordingTags(id, [' Planning ', 'planning', 'Client call'])
    expect(getDetail(id).tags).toEqual(['Planning', 'Client call'])
    setRecordingTags(id, ['Follow up'])
    expect(getDetail(id).tags).toEqual(['Follow up'])
    setRecordingTags(id, [])
    expect(getDetail(id).tags).toEqual([])
    expect(queryOne('SELECT filename,file_path,checksum,verified FROM recordings WHERE id=?', [id])).toEqual({ filename: 'original.hda', file_path: '/saved/original.hda', checksum: 'verified-checksum', verified: 1 })
  })
  it.each([null, [''], ['bad\ntag'], ['x'.repeat(41)], [42], Array(21).fill('tag')])('rejects invalid tags without erasing the previous set: %j', value => {
    setRecordingTags(id, ['Keep'])
    expect(() => setRecordingTags(id, value)).toThrow()
    expect(getDetail(id).tags).toEqual(['Keep'])
  })
  it('moves a recording between folders and back to unfiled without touching local audio', () => {
    const first = createProject('Planning'), second = createProject('Interviews')
    assignRecordingProject(id, first.id)
    expect(libraryNavigation().projectRecordings?.[first.id][0].id).toBe(id)
    expect(libraryNavigation().looseRecordings).toEqual([])
    assignRecordingProject(id, second.id)
    expect(getDetail(id).recording.projectId).toBe(second.id)
    assignRecordingProject(id, null)
    expect(libraryNavigation().looseRecordings[0].id).toBe(id)
    expect(queryOne('SELECT file_path,checksum,verified FROM recordings WHERE id=?', [id])).toEqual({ file_path: '/saved/original.hda', checksum: 'verified-checksum', verified: 1 })
  })
  it('rejects missing folders and recordings before changing any membership', () => {
    const missing = '11111111-1111-4111-8111-111111111111'
    expect(() => assignRecordingProject(id, missing)).toThrow('no longer exists')
    expect(() => assignRecordingProject(missing, null)).toThrow('not found')
    expect(() => setRecordingTags(missing, ['Tag'])).toThrow('not found')
    expect(getDetail(id).recording.projectId).toBeNull()
  })
})
