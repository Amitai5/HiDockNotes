import { WrittenNotes } from '../services/written-notes'
import type { NoteDocument } from '../../../src/shared/notes'
import { libraryContent } from '../services/library-content'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, getDetail, initializeDatabase, queryAll, queryOne, run, upsertRecordingFromDevice } from '../services/database'
import { saveProcessingResult } from '../ai/processing-store'
import { parseSummary } from '../ai/provider-parsing'
import { exportTranscript } from '../services/transcript-export'
import { DEFAULT_AI_SETTINGS } from '../../../src/shared/ai'
import { withoutActionItems } from '../../../src/shared/summary-content'

beforeEach(() => initializeDatabase(':memory:'))
afterEach(closeDatabase)
const recording = () => upsertRecordingFromDevice({ filename: 'meeting.hda', size: 100, duration: 10, dateCreated: new Date('2026-10-07T10:00:00Z') }).id
const notes = 'A pilot was approved.\n\n## Decisions\nRun a pilot.\n\n## Action items\n### Owners\nARCHIVED TASK TABLE\n\n## Next steps\nDiscuss pilot results next week.'

describe('retired managed tasks', () => {
  it('never inserts, reconciles or removes archived tasks when saving or regenerating notes', () => {
    const id = recording()
    run('INSERT INTO actionables(id,recording_id,text,done,owner,due_date) VALUES (?,?,?,0,?,NULL)', ['open', id, 'Undated legacy task', 'Dana'])
    run('INSERT INTO actionables(id,recording_id,text,done,owner,due_date) VALUES (?,?,?,1,?,?)', ['done', id, 'Completed legacy task', 'Alex', '2026-10-08'])
    const before = queryAll('SELECT * FROM actionables ORDER BY id')
    const summary = { title: 'Pilot', summary: 'Discuss the pilot results.', actionItems: [{ text: 'Undated legacy task', start: 1, owner: 'Changed owner', dueDate: '2027-01-01' }, { text: 'New unwanted task', start: 2 }] }
    const result = { duration: 10, segments: [], speakers: [], empty: false, transcriptChanged: false, summary }

    saveProcessingResult(id, result, DEFAULT_AI_SETTINGS)
    saveProcessingResult(id, { ...result, summary: { ...summary, actionItems: [] } }, DEFAULT_AI_SETTINGS)

    expect(queryAll('SELECT * FROM actionables ORDER BY id')).toEqual(before)
    expect(getDetail(id).actionables).toEqual([])
    expect(getDetail(id).recording.summary).toBe(summary.summary)
  })
  it('accepts task-free summaries and ignores even malformed retired provider fields', () => {
    const summary = parseSummary(JSON.stringify({ title: 'Pilot', summary: notes, actionItems: 'legacy and no longer validated' }), 10)
    expect(summary.actionItems).toEqual([])
    expect(summary.summary).not.toContain('ARCHIVED TASK TABLE')
    expect(summary.summary).toContain('Discuss pilot results next week.')
    expect(() => parseSummary(JSON.stringify({ title: 'Pilot', summary: '## Action items\nOnly tasks' }), 10)).toThrow('no meeting notes')
  })
  it('omits only the task section including nested headings, keeping later sections and fenced examples', () => {
    const cleaned = withoutActionItems(notes)
    expect(cleaned).toContain('## Decisions\nRun a pilot.')
    expect(cleaned).toContain('## Next steps\nDiscuss pilot results next week.')
    expect(cleaned).not.toContain('Owners')
    expect(cleaned).not.toContain('ARCHIVED TASK TABLE')
    const literal = 'A code example:\n```markdown\n## Action items\nExample heading\n```\n\n## Next steps\nKeep the example.'
    expect(withoutActionItems(literal)).toBe(literal)
    expect(withoutActionItems('# **Action items**\nOld task\n## Nested\nOld detail\n# Notes\nKeep me')).toBe('# Notes\nKeep me')
    expect(withoutActionItems('## ACTION ITEMS:\n~~~md\n## Fake heading\n~~~\n## Decisions\nKeep me')).toBe('## Decisions\nKeep me')
  })
  it('omits old task tables in content-rail previews while preserving written-note checklists', () => {
    const id = recording()
    run('INSERT INTO summaries(id,recording_id,text) VALUES (?,?,?)', ['summary', id, notes])
    const item = libraryContent({ kind: 'recording' }).items[0]
    expect(item.preview).not.toContain('ARCHIVED TASK TABLE')
    expect(item.preview).toContain('Discuss pilot results next week.')
    expect(item.kind === 'recording' && item.recording.summary).toBe(item.preview)
    const document: NoteDocument = { type: 'doc', content: [{ type: 'heading', attrs: { id: 'heading', level: 2 }, content: [{ type: 'text', text: 'Action items' }] }, { type: 'taskList', content: [{ type: 'taskItem', attrs: { id: 'task', checked: true }, content: [{ type: 'paragraph', attrs: { id: 'words' }, content: [{ type: 'text', text: 'Keep my personal checklist' }] }] }] }] }
    const written = new WrittenNotes({ changed: () => undefined, id: () => '11111111-1111-4111-8111-111111111111', now: () => new Date('2026-11-03T18:00:00Z') })
    const note = written.create({ requestId: '22222222-2222-4222-8222-222222222222', title: 'Personal checklist', projectId: null, document })
    expect(libraryContent({ kind: 'note' }).items[0].preview).toContain('Keep my personal checklist')
    expect(note.document).toEqual(document)
    expect(queryAll('SELECT * FROM actionables')).toEqual([])
    expect(queryOne('SELECT text FROM summaries WHERE recording_id=?', [id])).toEqual({ text: notes })
  })
  it.each(['md', 'txt'] as const)('omits managed tasks from %s exports without rewriting saved notes or transcript words', format => {
    const id = recording()
    run('INSERT INTO summaries(id,recording_id,text) VALUES (?,?,?)', ['summary', id, notes])
    run('INSERT INTO segments(id,recording_id,start,end,text) VALUES (?,?,1,2,?)', ['segment', id, 'We discussed action items in the meeting.'])
    const detail = getDetail(id)
    detail.actionables = [{ id: 'legacy', text: 'ARCHIVED ROW', done: false, start: 1 }]

    const output = exportTranscript(detail, format)

    expect(output).not.toContain('ARCHIVED ROW')
    expect(output).not.toContain('ARCHIVED TASK TABLE')
    expect(output).toContain('Discuss pilot results next week.')
    expect(output).toContain('We discussed action items in the meeting.')
    expect(queryOne('SELECT text FROM summaries WHERE recording_id=?', [id])).toEqual({ text: notes })
  })
})
