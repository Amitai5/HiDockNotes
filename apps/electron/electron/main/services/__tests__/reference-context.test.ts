import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, createProject, initializeDatabase, queryOne, run, upsertRecordingFromDevice } from '../database'
import { readReferenceContext, referenceContextSnapshot, saveReferenceContext } from '../reference-context'
import { EMPTY_REFERENCE_CONTEXT, REFERENCE_CONTEXT_LIMITS } from '../../../../src/shared/reference-context'

describe('global and project reference context', () => {
  beforeEach(() => { initializeDatabase(':memory:'); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-20T12:00:00Z')) })
  afterEach(() => { vi.useRealTimers(); closeDatabase() })
  it('starts empty, saves normalized context locally, and preserves unrelated settings', () => {
    run("INSERT INTO settings VALUES ('name','\"Dana\"')")
    expect(readReferenceContext(null)).toEqual({ content: EMPTY_REFERENCE_CONTEXT, version: 0, updatedAt: null })
    const saved = saveReferenceContext(null, { background: ' Shared background\r\nSecond line ', people: 'Dana Lee', terminology: 'CRM — customer relationship management' }, 0)
    expect(saved).toEqual({ content: { background: 'Shared background\nSecond line', people: 'Dana Lee', terminology: 'CRM — customer relationship management' }, version: 1, updatedAt: '2026-10-20T12:00:00.000Z' })
    expect(readReferenceContext(null)).toEqual(saved)
    expect(queryOne<{ value: string }>("SELECT value FROM settings WHERE key='name'")?.value).toBe('"Dana"')
  })
  it('keeps projects independent and includes global context for unfiled recordings', () => {
    const first = createProject('First'), second = createProject('Second')
    saveReferenceContext(null, { ...EMPTY_REFERENCE_CONTEXT, terminology: 'Shared terminology' }, 0)
    saveReferenceContext(first.id, { ...EMPTY_REFERENCE_CONTEXT, background: 'Private first project background' }, 0)
    expect(readReferenceContext(second.id).content).toEqual(EMPTY_REFERENCE_CONTEXT)
    expect(referenceContextSnapshot(null)).toEqual({ global: { ...EMPTY_REFERENCE_CONTEXT, terminology: 'Shared terminology' }, projects: [] })
    expect(referenceContextSnapshot(first.id).projects).toEqual([{ id: first.id, name: 'First', recordingIds: [], content: { ...EMPTY_REFERENCE_CONTEXT, background: 'Private first project background' } }])
  })
  it('rejects stale saves even after context has been cleared', () => {
    const saved = saveReferenceContext(null, { ...EMPTY_REFERENCE_CONTEXT, people: 'Dana Lee' }, 0)
    const cleared = saveReferenceContext(null, EMPTY_REFERENCE_CONTEXT, saved.version)
    expect(cleared.version).toBe(2)
    expect(() => saveReferenceContext(null, { ...EMPTY_REFERENCE_CONTEXT, people: 'Stale name' }, 0)).toThrow('another window')
    expect(readReferenceContext(null)).toEqual(cleared)
  })
  it('rejects deleted project scopes instead of writing orphan context', () => {
    const project = createProject('Removed')
    run('DELETE FROM projects WHERE id=?', [project.id])
    expect(() => readReferenceContext(project.id)).toThrow('no longer exists')
    expect(() => saveReferenceContext(project.id, EMPTY_REFERENCE_CONTEXT, 0)).toThrow('no longer exists')
  })
  it.each([null, [], {}, { ...EMPTY_REFERENCE_CONTEXT, background: 123 }, { ...EMPTY_REFERENCE_CONTEXT, extra: 'ignored?' }, { ...EMPTY_REFERENCE_CONTEXT, toString: 'unexpected' }, { ...EMPTY_REFERENCE_CONTEXT, people: 'Bad\u0000name' }])('rejects malformed context without overwriting saved content: %j', content => {
    saveReferenceContext(null, { ...EMPTY_REFERENCE_CONTEXT, background: 'Keep this' }, 0)
    expect(() => saveReferenceContext(null, content, 1)).toThrow()
    expect(readReferenceContext(null).content.background).toBe('Keep this')
  })
  it.each(Object.entries(REFERENCE_CONTEXT_LIMITS))('enforces the %s size boundary', (field, limit) => {
    const content = { ...EMPTY_REFERENCE_CONTEXT, [field]: 'x'.repeat(limit) }
    expect(saveReferenceContext(null, content, 0).content).toEqual(content)
    expect(() => saveReferenceContext(null, { ...content, [field]: 'x'.repeat(limit + 1) }, 1)).toThrow('characters')
  })
  it.each([-1, 0.5, NaN, Infinity, '0', Number.MAX_SAFE_INTEGER])('rejects invalid version %s', version => {
    expect(() => saveReferenceContext(null, EMPTY_REFERENCE_CONTEXT, version)).toThrow('version')
  })
  it('includes only projects attached to retrieved sources in an all-library answer', () => {
    const included = createProject('Included'), excluded = createProject('Excluded')
    const source = upsertRecordingFromDevice({ filename: 'included.hda', size: 1, duration: 1, dateCreated: new Date('2026-10-20T12:00:00Z') })
    run('UPDATE recordings SET project_id=? WHERE id=?', [included.id, source.id])
    saveReferenceContext(included.id, { ...EMPTY_REFERENCE_CONTEXT, background: 'Relevant project' }, 0)
    saveReferenceContext(excluded.id, { ...EMPTY_REFERENCE_CONTEXT, background: 'Must not be sent' }, 0)
    const snapshot = referenceContextSnapshot(null, [source.id, source.id])
    expect(snapshot.projects).toHaveLength(1)
    expect(snapshot.projects[0]).toMatchObject({ id: included.id, recordingIds: [source.id] })
    expect(JSON.stringify(snapshot)).not.toContain('Must not be sent')
    expect(referenceContextSnapshot(excluded.id, [source.id]).projects[0].recordingIds).toEqual([])
  })
  it('fails clearly on corrupt saved context rather than silently losing it', () => {
    run('INSERT INTO settings VALUES (?,?)', ['reference-context:global', '{not json'])
    expect(() => readReferenceContext(null)).toThrow('could not be read')
    expect(() => saveReferenceContext(null, EMPTY_REFERENCE_CONTEXT, 0)).toThrow('could not be read')
  })
})
