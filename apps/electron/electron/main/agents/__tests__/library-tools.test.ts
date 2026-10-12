import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initializeDatabase, closeDatabase, upsertRecordingFromDevice, createProject, queryAll, queryOne, run } from '../../services/database'
import { LibraryAgentTools } from '../library-tools'

let tools: LibraryAgentTools, recordingId: string, projectId: string
beforeEach(() => {
  initializeDatabase(':memory:')
  tools = new LibraryAgentTools({ all: queryAll, one: queryOne })
  const project = createProject('Planning')
  projectId = project.id
  const recording = upsertRecordingFromDevice({ filename: 'call.hda', size: 200, duration: 10, dateCreated: new Date('2026-10-07T10:00:00Z') })
  recordingId = recording.id
  run("UPDATE recordings SET project_id=?,file_path='/private/audio.hda',checksum='private-checksum',verified=1,status='done' WHERE id=?", [project.id, recordingId])
  run('INSERT INTO transcripts(id,recording_id,text) VALUES (?,?,?)', ['transcript', recordingId, 'Approve the budget'])
  run('INSERT INTO summaries(id,recording_id,text) VALUES (?,?,?)', ['summary', recordingId, '## Budget decisions'])
  run('INSERT INTO segments(id,recording_id,start,end,text) VALUES (?, ?, 0, 5, ?),(?, ?, 5, 10, ?)', ['a', recordingId, 'Approve the budget', 'b', recordingId, 'Send the plan'])
  run('INSERT INTO actionables(id,recording_id,text,created_at,due_date,start) VALUES (?,?,?, ?,?,5)', ['open', recordingId, 'Send the plan', '2026-10-07T10:05:00Z', '2026-10-12'])
  run('INSERT INTO actionables(id,recording_id,text,done) VALUES (?,?,?,1)', ['done', recordingId, 'Approve spending'])
  run("INSERT INTO settings VALUES ('secret','private-api-key')")
})
afterEach(closeDatabase)
describe('read-only library tools', () => {
  it('searches actual FTS content and supports a project scope', () => {
    expect(tools.call('search_recordings', { query: 'budget', projectId })).toMatchObject({ recordings: [{ id: recordingId, projectId }], nextOffset: null })
    expect(tools.call('search_recordings', { query: 'budget', projectId: null })).toMatchObject({ recordings: [] })
    expect(() => tools.call('search_recordings', { query: '" OR *' })).not.toThrow()
  })
  it('paginates timestamped transcripts and preserves creation dates and deadlines', () => {
    const first = tools.call('get_recording', { recordingId, segmentLimit: 1 }) as { nextSegmentOffset: number }
    expect(first).toMatchObject({ recording: { summary: '## Budget decisions' }, segments: [{ start: 0, end: 5 }], nextSegmentOffset: 1, actionItems: expect.arrayContaining([expect.objectContaining({ createdAt: '2026-10-07T10:05:00Z', dueDate: '2026-10-12' })]) })
    expect(tools.call('get_recording', { recordingId, segmentLimit: 1, segmentOffset: first.nextSegmentOffset })).toMatchObject({ segments: [{ start: 5, end: 10 }], nextSegmentOffset: null })
  })
  it('lists open and completed action items independently', () => {
    expect(tools.call('list_action_items', {})).toMatchObject({ actionItems: [{ id: 'open', done: false }] })
    expect(tools.call('list_action_items', { done: true })).toMatchObject({ actionItems: [{ id: 'done', done: true }] })
    expect(tools.call('list_action_items', { projectId: null })).toMatchObject({ actionItems: [] })
  })
  it('keeps complete transcript segments and pages long summaries without losing text', () => {
    const text = 'Long transcript '.repeat(400)
    const summary = 'Long summary '.repeat(3000)
    run('UPDATE segments SET text=? WHERE id=?', [text, 'a'])
    run('UPDATE summaries SET text=? WHERE recording_id=?', [summary, recordingId])
    const first = tools.call('get_recording', { recordingId, segmentLimit: 1 }) as { recording: { summary: string }; nextSummaryOffset: number; segments: { text: string }[] }
    const second = tools.call('get_recording', { recordingId, summaryOffset: first.nextSummaryOffset }) as { recording: { summary: string }; nextSummaryOffset: null }
    expect(first.segments[0].text).toBe(text)
    expect(first.recording.summary + second.recording.summary).toBe(summary)
    expect(second.nextSummaryOffset).toBeNull()
  })
  it('exposes folders and loose recordings without filesystem paths, credentials, or checksums', () => {
    upsertRecordingFromDevice({ filename: 'loose.hda', size: 2, duration: 1, dateCreated: new Date('2026-10-07T11:00:00Z') })
    expect(tools.call('list_projects', {})).toMatchObject({ projects: [{ id: projectId, name: 'Planning', count: 1 }] })
    expect(tools.call('list_recordings', { projectId: null })).toMatchObject({ recordings: [{ filename: 'loose.hda' }] })
    const output = JSON.stringify([tools.call('get_recording', { recordingId }), tools.call('list_recordings', {})])
    expect(output).not.toMatch(/file_path|private-api-key|private-checksum|embedding|ciphertext|\/private/)
  })
  it.each([['delete_recording', {}], ['get_recording', { recordingId: '../../private' }], ['list_recordings', { limit: 51 }], ['list_recordings', { offset: -1 }], ['list_recordings', { status: 'unknown' }], ['list_action_items', { done: 'false' }], ['search_recordings', { query: '' }], ['list_recordings', { sql: 'DELETE FROM recordings' }]])('rejects unavailable tools and invalid arguments: %s', (name, argumentsValue) => {
    expect(() => tools.call(name as string, argumentsValue)).toThrow()
    expect(queryOne<{ count: number }>('SELECT count(*) AS count FROM recordings')?.count).toBe(1)
  })
})
