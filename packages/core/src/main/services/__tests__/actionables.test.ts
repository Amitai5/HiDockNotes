import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, initializeDatabase, listActionables, run, upsertRecordingFromDevice } from '../database'
import { updateActionable } from '../actionables'
import { saveProcessingResult } from '../../ai/processing-store'
import { DEFAULT_AI_SETTINGS } from '../../../../src/shared/ai'
import { isDateOnly, formatDueDate } from '../../../../src/shared/actionables'

describe('action item dates and completion', () => {
  let recordingId: string
  const createdAt = '2026-10-08T08:00:00Z', now = new Date('2026-10-08T18:00:00Z')
  beforeEach(() => {
    initializeDatabase(':memory:')
    recordingId = upsertRecordingFromDevice({ filename: 'call.hda', size: 10, duration: 5, dateCreated: new Date(createdAt) }).id
    run('INSERT INTO actionables(id, recording_id, text, start, created_at) VALUES (?, ?, ?, ?, ?)', ['task', recordingId, 'Send the plan', 1, createdAt])
  })
  afterEach(closeDatabase)
  it('persists completion, retains the original creation date, and supports reopening', () => {
    updateActionable('task', { done: true }, now)
    expect(listActionables()[0]).toMatchObject({ done: true, createdAt, completedAt: now.toISOString() })
    updateActionable('task', { done: true }, new Date('2026-10-09T18:00:00Z'))
    expect(listActionables()[0].completedAt).toBe(now.toISOString())
    updateActionable('task', { done: false }, now)
    expect(listActionables()[0]).toMatchObject({ done: false, completedAt: null })
  })
  it('saves and clears a due date without changing the creation date', () => {
    updateActionable('task', { text: 'Send the final plan', dueDate: '2026-10-12' }, now)
    expect(listActionables()[0]).toMatchObject({ text: 'Send the final plan', dueDate: '2026-10-12', createdAt })
    updateActionable('task', { dueDate: null }, now)
    expect(listActionables()[0].dueDate).toBeNull()
  })
  it.each([{ dueDate: '2026-02-30', done: true }, { dueDate: 'tomorrow' }, { text: '  ', done: true }, { done: 'yes' }, { unexpected: true }, {}])('rejects an invalid patch atomically: %j', patch => {
    expect(() => updateActionable('task', patch, now)).toThrow()
    expect(listActionables()[0]).toMatchObject({ text: 'Send the plan', done: false, dueDate: null, createdAt })
  })
  it('reports missing tasks instead of claiming an update succeeded', () => { expect(() => updateActionable('missing', { done: true }, now)).toThrow('not found') })
  it('stores generated dates and does not reset completed tasks when the summary is regenerated', () => {
    updateActionable('task', { done: true, dueDate: '2026-10-12' }, now)
    const result = { empty: false, duration: 5, speakers: [], segments: [], summary: { title: 'Plan', summary: '## Decisions\nSend the plan.', actionItems: [{ text: 'Send the plan', start: 2, dueDate: '2026-10-15' }, { text: 'Review budget', start: 3, dueDate: '2026-10-20' }] } }
    saveProcessingResult(recordingId, result, DEFAULT_AI_SETTINGS)
    expect(listActionables().find(item => item.id === 'task')).toMatchObject({ done: true, createdAt, dueDate: '2026-10-12', completedAt: now.toISOString() })
    expect(listActionables().find(item => item.text === 'Review budget')).toMatchObject({ done: false, dueDate: '2026-10-20', createdAt: expect.any(String) })
  })
  it('does not invent historical creation or due dates for legacy items', () => {
    run('INSERT INTO actionables(id,recording_id,text) VALUES (?, ?, ?)', ['old', recordingId, 'Old task'])
    expect(listActionables().find(item => item.id === 'old')).toMatchObject({ createdAt: null, dueDate: null, completedAt: null })
  })
  it('validates real calendar days and displays date-only deadlines without a time-zone shift', () => {
    expect(isDateOnly('2028-02-29')).toBe(true)
    expect(isDateOnly('2026-02-29')).toBe(false)
    expect(isDateOnly('2026-10-12T00:00:00Z')).toBe(false)
    expect(formatDueDate('2026-10-12')).toContain('12')
  })
})
