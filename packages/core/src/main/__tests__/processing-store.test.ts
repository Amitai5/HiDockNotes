import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, getDetail, initializeDatabase, queryOne, renameRecording, run, upsertRecordingFromDevice } from '../services/database'
import { setRecordingTags } from '../services/recording-metadata'
import { savedTranscript, saveProcessingResult, saveTranscript } from '../ai/processing-store'
import { DEFAULT_AI_SETTINGS } from '../../../src/shared/ai'

describe('saving regenerated meeting notes', () => {
  beforeEach(() => initializeDatabase(':memory:'))
  afterEach(closeDatabase)
  it('persists meeting metadata and owners, replaces generated tags and preserves user edits and transcript settings', () => {
    const id = upsertRecordingFromDevice({ filename: 'fixture.hda', size: 100, duration: 10, dateCreated: new Date('2026-10-07T10:00:00Z') }).id
    renameRecording(id, 'Custom title'); setRecordingTags(id, ['personal'])
    const checkpoint = { duration: 10, speakers: [], segments: [{ id: 'segment', start: 1, end: 2, text: 'Actual original words', speakerId: null, speakerName: null }] }
    saveTranscript(id, checkpoint, DEFAULT_AI_SETTINGS)
    const original = queryOne('SELECT * FROM transcripts WHERE recording_id=?', [id])
    run("INSERT INTO recording_tags(recording_id,tag,source) VALUES (?,'old-topic','ai')", [id])
    run("INSERT INTO actionables(id,recording_id,text,done,due_date,created_at) VALUES ('completed',?,'Send the plan',1,'2026-10-15','2026-10-07T10:00:00Z')", [id])
    const summary = { title: 'Generated title', meetingType: 'Planning', participants: [{ speakerId: null, name: 'Dana Lee', organizer: true }], tags: ['planning', 'operations', 'meeting'], summary: 'New summary', actionItems: [{ text: 'Send the plan', owner: 'Dana Lee', start: 1, dueDate: null }] }
    saveProcessingResult(id, { ...savedTranscript(id), transcriptChanged: false, empty: false, summary }, { ...DEFAULT_AI_SETTINGS, language: 'fr', transcription: { provider: 'openai', model: 'whisper-1' } })
    expect(queryOne('SELECT * FROM transcripts WHERE recording_id=?', [id])).toEqual(original)
    expect(getDetail(id)).toMatchObject({ recording: { title: 'Custom title', summary: 'New summary' }, meeting: { meetingType: 'Planning', participants: summary.participants }, tags: ['personal', 'planning', 'operations', 'meeting'] })
    expect(getDetail(id).actionables[0]).toMatchObject({ id: 'completed', done: true, owner: 'Dana Lee', dueDate: '2026-10-15', createdAt: '2026-10-07T10:00:00Z' })
    setRecordingTags(id, ['personal', 'meeting', 'edited'])
    saveProcessingResult(id, { ...checkpoint, transcriptChanged: false, empty: false, summary: { ...summary, tags: ['planning', 'client', 'call'] } }, DEFAULT_AI_SETTINGS)
    expect(getDetail(id).tags).toEqual(['personal', 'edited', 'planning', 'client', 'call'])
    setRecordingTags(id, ['Planning'])
    saveProcessingResult(id, { ...checkpoint, transcriptChanged: false, empty: false, summary }, DEFAULT_AI_SETTINGS)
    expect(getDetail(id).tags).toEqual(['Planning', 'operations', 'meeting'])
  })
  it('names an automatic placeholder on summary-only completion and keeps later manual edits', () => {
    const id = upsertRecordingFromDevice({ filename: 'fixture.hda', size: 100, duration: 10, dateCreated: new Date('2026-10-07T10:00:00Z') }).id
    run("UPDATE recordings SET title='fixture.hda',title_source='placeholder' WHERE id=?", [id])
    const checkpoint = { duration: 10, speakers: [], segments: [{ id: 'segment', start: 1, end: 2, text: 'Actual saved words', speakerId: null, speakerName: null }] }
    saveTranscript(id, checkpoint, DEFAULT_AI_SETTINGS)
    const before = queryOne('SELECT * FROM transcripts WHERE recording_id=?', [id])
    const summary = { title: 'Generated Topic Name', summary: 'Saved notes.', actionItems: [] }

    saveProcessingResult(id, { ...savedTranscript(id), transcriptChanged: false, empty: false, summary }, DEFAULT_AI_SETTINGS)

    expect(queryOne('SELECT title,title_source FROM recordings WHERE id=?', [id])).toEqual({ title: summary.title, title_source: 'ai' })
    expect(queryOne('SELECT * FROM transcripts WHERE recording_id=?', [id])).toEqual(before)
    renameRecording(id, 'fixture.hda')
    saveProcessingResult(id, { ...savedTranscript(id), transcriptChanged: false, empty: false, summary: { ...summary, title: 'Next Topic Name' } }, DEFAULT_AI_SETTINGS)
    expect(queryOne('SELECT title,title_source FROM recordings WHERE id=?', [id])).toEqual({ title: 'fixture.hda', title_source: 'manual' })
  })
  it('persists structured outcomes with their notes and replaces them when notes are regenerated', () => {
    const id = upsertRecordingFromDevice({ filename: 'outcomes.hda', size: 10, duration: 10, dateCreated: new Date('2026-10-07T10:00:00Z') }).id
    const checkpoint = { duration: 10, speakers: [], segments: [{ id: 'segment', start: 1, end: 2, text: 'We approved the pilot.', speakerId: null, speakerName: null }] }
    const outcomes = [{ kind: 'decision' as const, text: 'The pilot was approved.', answerer: null, start: 1, evidence: 'We approved the pilot.', source: 'transcript' as const }]
    const summary = { title: 'Pilot', summary: '## Decisions\nThe pilot was approved.', actionItems: [], outcomes }
    saveProcessingResult(id, { ...checkpoint, empty: false, summary }, DEFAULT_AI_SETTINGS)
    expect(JSON.parse(queryOne<{ outcomes: string }>('SELECT outcomes FROM summaries WHERE recording_id=?', [id])!.outcomes)).toEqual(outcomes)
    saveProcessingResult(id, { ...checkpoint, transcriptChanged: false, empty: false, summary: { ...summary, outcomes: [], summary: '## Decisions\nNone recorded.' } }, DEFAULT_AI_SETTINGS)
    expect(queryOne('SELECT outcomes FROM summaries WHERE recording_id=?', [id])).toEqual({ outcomes: '[]' })
  })
})
