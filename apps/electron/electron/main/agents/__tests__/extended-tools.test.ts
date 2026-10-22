import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, createProject, initializeDatabase, queryAll, queryOne, run, upsertRecordingFromDevice } from '../../services/database'
import { readReferenceContext, saveReferenceContext } from '../../services/reference-context'
import { EMPTY_REFERENCE_CONTEXT } from '../../../../src/shared/reference-context'
import { LibraryAgentTools } from '../library-tools'
import { legacyMeetingOutcomes, type MeetingOutcome } from '../../../../src/shared/meeting-outcomes'

let tools: LibraryAgentTools, projectId: string, otherProjectId: string, id: string
function recording(filename: string, project: string | null, date = '2026-10-08T10:00:00.000Z', text = 'The lender charges interest.'): string {
  const recordingId = upsertRecordingFromDevice({ filename, size: 1, duration: 30, dateCreated: new Date(date) }).id
  run("UPDATE recordings SET project_id=?,verified=1,status='done' WHERE id=?", [project, recordingId])
  run('INSERT INTO transcripts(id,recording_id,text) VALUES (?,?,?)', ['t-' + filename, recordingId, text])
  run('INSERT INTO segments(id,recording_id,start,end,text) VALUES (?,?,10,20,?)', ['s-' + filename, recordingId, text])
  return recordingId
}
function notes(recordingId: string, text: string, outcomes: MeetingOutcome[] = legacyMeetingOutcomes(text)): void {
  run('INSERT INTO summaries(id,recording_id,text,outcomes) VALUES (?,?,?,?)', ['n-' + recordingId, recordingId, text, JSON.stringify(outcomes)])
}
beforeEach(() => {
  initializeDatabase(':memory:')
  projectId = createProject('Work').id; otherProjectId = createProject('Other').id
  id = recording('loan.hda', projectId)
  tools = new LibraryAgentTools({ all: queryAll, one: queryOne }, { referenceContext: readReferenceContext })
})
afterEach(closeDatabase)

describe('extended read-only agent tools', () => {
  it('returns matching transcript passages with timestamps instead of an unrelated summary prefix', () => {
    notes(id, 'Unrelated summary opening.')
    expect(tools.call('search_recordings', { query: 'interest', projectId })).toMatchObject({ mode: 'keywords', recordings: [{ id, excerpt: 'The lender charges interest.', match: { source: 'transcript', start: 10, end: 20 } }] })
    expect(tools.call('search_recordings', { query: 'interest', projectId: null })).toMatchObject({ recordings: [] })
  })
  it('keeps the matching phrase visible when a transcript segment is longer than the excerpt limit', () => {
    const text = 'Opening words. '.repeat(100) + 'The lender charges interest.'
    run('UPDATE segments SET text=? WHERE recording_id=?', [text, id])
    run('UPDATE transcripts SET text=? WHERE recording_id=?', [text, id])
    expect(tools.call('search_recordings', { query: 'interest' })).toMatchObject({ recordings: [{ excerpt: expect.stringContaining('interest'), match: { start: 10 } }] })
  })
  it('combines meaning and keyword matches, deduplicates, and paginates the ranked results', async () => {
    const other = recording('other.hda', projectId, '2026-10-07T10:00:00.000Z', 'Discuss borrowing costs.')
    const meaning = vi.fn(async () => ({ hits: [{ recordingId: id, title: 'Loan', text: 'The lender charges interest.', start: 10, end: 20, kind: 'transcript' as const, score: 0.9 }], fallbackReason: null, indexing: true, truncated: false }))
    const connected = new LibraryAgentTools({ all: queryAll, one: queryOne }, { meaningSearch: meaning })
    const first = await connected.call('search_recordings', { query: 'borrowing costs', mode: 'meaning', projectId, limit: 1 }) as { recordings: { id: string }[]; nextOffset: number }
    expect(first).toMatchObject({ mode: 'meaning', indexing: true, nextOffset: 1 })
    const second = await connected.call('search_recordings', { query: 'borrowing costs', mode: 'meaning', projectId, limit: 1, offset: first.nextOffset }) as { recordings: { id: string }[] }
    expect(new Set([...first.recordings, ...second.recordings].map(item => item.id))).toEqual(new Set([id, other]))
    expect(meaning).toHaveBeenCalledWith('borrowing costs', projectId, undefined)
  })
  it('reports keyword fallback explicitly when the optional model is unavailable', async () => {
    expect(await tools.call('search_recordings', { query: 'interest', mode: 'meaning' })).toMatchObject({ requestedMode: 'meaning', mode: 'keywords', fallbackReason: expect.stringContaining('Enable'), recordings: [{ id }] })
  })
  it('does not return a recording moved out of scope while inference was running', async () => {
    const meaning = vi.fn(async () => {
      run('UPDATE recordings SET project_id=? WHERE id=?', [otherProjectId, id])
      return { hits: [{ recordingId: id, title: 'Loan', text: 'Private passage', start: 10, end: 20, kind: 'transcript' as const, score: 1 }], fallbackReason: null, indexing: false, truncated: false }
    })
    const connected = new LibraryAgentTools({ all: queryAll, one: queryOne }, { meaningSearch: meaning })
    expect(await connected.call('search_recordings', { query: 'interest', mode: 'meaning', projectId })).toMatchObject({ recordings: [], nextOffset: null })
  })
  it('rereads keyword matches after inference so corrected text is not returned as an old excerpt', async () => {
    const connected = new LibraryAgentTools({ all: queryAll, one: queryOne }, { meaningSearch: async () => {
      run("UPDATE transcripts SET text='Corrected wording' WHERE recording_id=?", [id])
      run("UPDATE segments SET text='Corrected wording' WHERE recording_id=?", [id])
      return { hits: [], fallbackReason: null, indexing: false, truncated: false }
    } })
    expect(await connected.call('search_recordings', { query: 'interest', mode: 'meaning' })).toMatchObject({ recordings: [] })
  })
  it('exposes only global and explicitly requested project reference documents with provenance and versions', () => {
    saveReferenceContext(null, { ...EMPTY_REFERENCE_CONTEXT, terminology: 'Global terminology' }, 0)
    saveReferenceContext(projectId, { ...EMPTY_REFERENCE_CONTEXT, background: 'Work background' }, 0)
    saveReferenceContext(otherProjectId, { ...EMPTY_REFERENCE_CONTEXT, background: 'Other project only' }, 0)
    expect(tools.call('get_reference_context', {})).toMatchObject({ source: 'user_reference', isMeetingEvidence: false, global: { version: 1, content: { terminology: 'Global terminology' } }, project: null })
    const scoped = tools.call('get_reference_context', { projectId })
    expect(scoped).toMatchObject({ project: { id: projectId, name: 'Work', version: 1, content: { background: 'Work background' } } })
    expect(JSON.stringify(scoped)).not.toContain('Other project only')
    expect(() => tools.call('get_reference_context', { projectId: '00000000-0000-4000-8000-000000000000' })).toThrow('Project')
  })
  it('filters meeting outcomes by kind, project, recording, and inclusive dates with stable pagination', () => {
    notes(id, '## Decisions\n- Approve the pilot.\n- Use the new intake form.\n\n## Open questions\n- Is the API ready?')
    const loose = recording('loose.hda', null, '2026-10-07T10:00:00.000Z')
    notes(loose, '## Decisions\n- Keep the existing process.')
    const other = recording('private.hda', otherProjectId)
    notes(other, '## Decisions\n- A different project decision.')
    const first = tools.call('list_meeting_outcomes', { projectId, kind: 'decision', from: '2026-10-08', to: '2026-10-08', limit: 1 }) as { nextOffset: number }
    expect(first).toMatchObject({ outcomes: [{ recordingId: id, kind: 'decision', text: 'Approve the pilot.', start: null, evidence: null, source: 'summary', summaryStale: false }], nextOffset: 1 })
    expect(tools.call('list_meeting_outcomes', { recordingId: id, kind: 'decision', offset: first.nextOffset })).toMatchObject({ outcomes: [{ text: 'Use the new intake form.' }], nextOffset: null })
    expect(tools.call('list_meeting_outcomes', { projectId: null })).toMatchObject({ outcomes: [{ recordingId: loose }] })
    expect(tools.call('list_meeting_outcomes', { projectId, from: '2026-10-09' })).toMatchObject({ outcomes: [] })
  })
  it('returns transcript evidence and flags outcomes based on an older transcript revision', () => {
    notes(id, '## Decisions\n- Account for lender interest.', [{ kind: 'decision', text: 'Account for lender interest.', answerer: null, start: 10, evidence: 'The lender charges interest.', source: 'transcript' }])
    run("INSERT INTO transcript_revisions(recording_id,created_at,reason,segment_count,segments) VALUES (?,'2026-10-08T12:00:00.000Z','Edited',1,'[]')", [id])
    expect(tools.call('list_meeting_outcomes', { recordingId: id })).toMatchObject({ outcomes: [{ recordingId: id, start: 10, evidence: 'The lender charges interest.', source: 'transcript', summaryStale: true }] })
    run('DELETE FROM recordings WHERE id=?', [id])
    expect(tools.call('list_meeting_outcomes', {})).toMatchObject({ outcomes: [] })
  })
  it.each([
    ['search_recordings', { query: 'interest', mode: 'cloud' }],
    ['get_reference_context', { projectId: '../project' }],
    ['get_reference_context', { key: 'secret' }],
    ['list_meeting_outcomes', { kind: 'task' }],
    ['list_meeting_outcomes', { from: '2026-02-30' }],
    ['list_meeting_outcomes', { from: '2026-10-09', to: '2026-10-08' }],
    ['list_meeting_outcomes', { recordingId: '../../private' }],
    ['list_meeting_outcomes', { limit: 51 }]
  ])('rejects invalid arguments for %s', (name, args) => expect(() => tools.call(name as string, args)).toThrow())
})
