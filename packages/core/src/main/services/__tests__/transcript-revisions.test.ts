import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { closeDatabase, getDetail, initializeDatabase, queryAll, queryOne, run, upsertRecordingFromDevice } from '../database'
import { editTranscript, transcriptReview, restoreTranscriptRevision, stageTranscriptCandidate, chooseTranscriptCandidate, rememberTranscript } from '../transcript-revisions'
import { savedTranscript, saveProcessingResult, saveTranscript } from '../../ai/processing-store'
import { DEFAULT_AI_SETTINGS } from '../../../../src/shared/ai'

const date = new Date('2026-10-20T10:00:00Z')
let id: string
beforeEach(() => {
  initializeDatabase(':memory:')
  id = upsertRecordingFromDevice({ filename: 'call.hda', size: 20, duration: 12, dateCreated: date }).id
  saveTranscript(id, { duration: 12, speakers: [], segments: [{ id: 'first', start: 1, end: 3, text: 'Send it Friday', speakerId: null, speakerName: null }, { id: 'second', start: 5, end: 7, text: 'The plan was approved.', speakerId: null, speakerName: null }] }, DEFAULT_AI_SETTINGS)
  saveProcessingResult(id, { ...savedTranscript(id), transcriptChanged: false, empty: false, summary: { title: 'Planning', summary: 'A plan', actionItems: [] } }, DEFAULT_AI_SETTINGS)
})
afterEach(closeDatabase)
describe('recoverable transcript corrections', () => {
  it('updates search and summary input, preserves times, and records original and corrected revisions', () => {
    const before = transcriptReview(id)
    editTranscript(id, 'first', 'Send it Thursday', before.version)
    const review = transcriptReview(id)
    expect(getDetail(id).segments[0]).toMatchObject({ start: 1, end: 3, text: 'Send it Thursday', speakerId: null })
    expect(savedTranscript(id).segments[0].text).toBe('Send it Thursday')
    expect(queryOne<{ transcript: string }>('SELECT transcript FROM recording_fts WHERE recording_id=?', [id])!.transcript).toContain('Thursday')
    expect(review).toMatchObject({ summaryStale: true, correctedSegments: ['first'] })
    expect(review.revisions).toHaveLength(2)
    expect(() => editTranscript(id, 'first', 'Stale save', before.version)).toThrow('changed')
    expect(() => editTranscript(id, 'missing', 'Words', review.version)).toThrow('not found')
    expect(() => editTranscript(id, 'first', ' ', review.version)).toThrow('Enter transcript')
  })
  it('restores a prior version without changing timestamps or losing later history', () => {
    const original = transcriptReview(id).version
    editTranscript(id, 'first', 'Corrected', original)
    const edited = transcriptReview(id).version
    restoreTranscriptRevision(id, original, edited)
    expect(getDetail(id).segments[0]).toMatchObject({ text: 'Send it Friday', start: 1, end: 3 })
    expect(transcriptReview(id).revisions).toHaveLength(3)
    restoreTranscriptRevision(id, edited, transcriptReview(id).version)
    expect(getDetail(id).segments[0].text).toBe('Corrected')
    expect(transcriptReview(id).revisions).toHaveLength(4)
  })
  it('rejects changes during processing or a pending deletion', () => {
    run("INSERT INTO transcription_jobs(id,recording_id,stage,created_at) VALUES ('job',?,'queued',?)", [id, date.toISOString()])
    expect(() => editTranscript(id, 'first', 'Changed', transcriptReview(id).version)).toThrow('finish processing')
    run("UPDATE transcription_jobs SET stage='done'")
    run("INSERT INTO recording_deletions(recording_id,created_at) VALUES (?,?)", [id, date.toISOString()])
    expect(() => editTranscript(id, 'first', 'Changed', transcriptReview(id).version)).toThrow('deleted')
  })
  it('keeps corrections active until a candidate is reviewed, previews the exact merge and preserves history', () => {
    editTranscript(id, 'first', 'Send it Thursday', transcriptReview(id).version)
    const candidate = { duration: 12, speakers: [], segments: [{ id: 'new-first', start: 0, end: 4, text: 'New overlapping text', speakerId: null, speakerName: null }, { id: 'new-second', start: 5, end: 8, text: 'Approved the revised plan.', speakerId: null, speakerName: null }] }
    stageTranscriptCandidate(id, candidate, DEFAULT_AI_SETTINGS)
    expect(getDetail(id).segments[0].text).toBe('Send it Thursday')
    const review = transcriptReview(id)
    expect(review.candidate!.merged.map(segment => segment.text)).toEqual(['Send it Thursday', 'Approved the revised plan.'])
    const selected = chooseTranscriptCandidate(id, 'keep-corrections', review.version)!
    saveTranscript(id, selected.checkpoint, selected.settings)
    expect(getDetail(id).segments.map(segment => segment.text)).toEqual(review.candidate!.merged.map(segment => segment.text))
    expect(transcriptReview(id).revisions.length).toBeGreaterThan(2)
    rememberTranscript(id, 'Identical save')
    expect(queryAll('SELECT * FROM transcript_revisions WHERE recording_id=?', [id])).toHaveLength(3)
  })
  it('discards a candidate without touching saved notes or corrected words, and cascades history on deletion', () => {
    editTranscript(id, 'first', 'Thursday', transcriptReview(id).version)
    stageTranscriptCandidate(id, savedTranscript(id), DEFAULT_AI_SETTINGS)
    expect(chooseTranscriptCandidate(id, 'discard', transcriptReview(id).version)).toBeNull()
    expect(transcriptReview(id).candidate).toBeNull()
    expect(getDetail(id).recording.summary).toBe('A plan')
    run('DELETE FROM recordings WHERE id=?', [id])
    for (const table of ['transcript_revisions', 'transcript_corrections', 'transcript_candidates']) expect(queryAll(`SELECT * FROM ${table}`)).toEqual([])
  })
})
