import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectBriefings, parseBriefingContent, validateBriefingOptions } from '../ai/project-briefing'
import { closeDatabase, createProject, initializeDatabase, queryOne, run, upsertRecordingFromDevice } from '../services/database'
import { assignRecordingProject } from '../services/recording-metadata'
import { saveReferenceContext } from '../services/reference-context'
import { EMPTY_REFERENCE_CONTEXT } from '../../../src/shared/reference-context'
import { DEFAULT_AI_SETTINGS, type AIState } from '../../../src/shared/ai'
import type { ProviderClient } from '../ai/providers'
import type { BriefingSource } from '../../../src/shared/project-briefing'

const now = () => new Date('2026-11-03T18:00:00Z'), options = { days: 30 }
let project: string, other: string, service: ProjectBriefings, ai: AIState
const chat = vi.fn(), read = vi.fn(), changed = vi.fn()
function result(numbers = [1], changes = false): string { return JSON.stringify({ overview: [{ text: 'The project is preparing a pilot.', sources: [numbers[0]] }], changes: changes ? [{ text: 'The pilot budget was revised.', sources: numbers }] : [], decisions: [{ text: 'Prepare the pilot.', sources: [numbers[0]] }], questions: [] }) }
function meeting(filename: string, projectId = project, date = '2026-11-02T15:00:00Z', summary = 'Prepare the pilot.'): string {
  const row = upsertRecordingFromDevice({ filename, duration: 120, size: 100, dateCreated: new Date(date) })
  run('UPDATE recordings SET verified=1,project_id=?,title=? WHERE id=?', [projectId, filename.replace('.hda', ''), row.id])
  run('INSERT INTO summaries(id,recording_id,text,outcomes) VALUES (?,?,?,?)', ['summary-' + filename, row.id, summary, '[]'])
  run('INSERT INTO segments(id,recording_id,start,end,text) VALUES (?,?,10,20,?)', ['segment-' + filename, row.id, 'Prepare the pilot.'])
  return row.id
}
function make(): ProjectBriefings { return new ProjectBriefings({ now, vault: { read }, providers: () => ({ chat } as unknown as ProviderClient), state: () => ai, changed }) }
beforeEach(() => {
  initializeDatabase(':memory:'); project = createProject('Pilot').id; other = createProject('Private project').id
  ai = { settings: DEFAULT_AI_SETTINGS, providers: [], ready: true, reason: null, summaryReady: true, summaryReason: null }
  chat.mockReset().mockResolvedValue(result()); read.mockReset().mockReturnValue('private-test-key'); changed.mockReset(); service = make()
})
afterEach(async () => { await service.stop(); closeDatabase() })

describe('on-demand project briefings', () => {
  it('reads project coverage without requesting AI or exposing archived task data', () => {
    const id = meeting('recent.hda')
    run('INSERT INTO actionables(id,recording_id,text,due_date) VALUES (?,?,?,?)', ['archived', id, 'ARCHIVED TASK', '2026-11-01'])
    const state = service.get(project, options)
    expect(state.coverage).toMatchObject({ recentMeetings: 1, includedMeetings: 1 })
    expect(state).not.toHaveProperty('tasks'); expect(state.coverage).not.toHaveProperty('overdueTasks')
    expect(state.briefing).toBeNull(); expect(chat).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled()
    expect(queryOne('SELECT text FROM actionables WHERE id=?', ['archived'])).toEqual({ text: 'ARCHIVED TASK' })
  })
  it('generates once, stores the result on the server and reopens it without another request', async () => {
    meeting('recent.hda')
    const generated = await service.generate(project, options)
    expect(generated.briefing?.content.overview[0].text).toBe('The project is preparing a pilot.')
    expect(generated.briefing?.generatedAt).toBe(now().toISOString()); expect(generated.busy).toBe(false)
    expect(make().get(project, options).briefing).toEqual(generated.briefing)
    expect(chat).toHaveBeenCalledTimes(1)
    expect(queryOne<{ value: string }>('SELECT value FROM settings WHERE key=?', [`project-briefing:${project}:30`])?.value).toContain('The project is preparing a pilot.')
  })
  it('sends only in-range, verified, current summaries and the selected project reference', async () => {
    meeting('recent.hda'); meeting('other.hda', other, undefined, 'OTHER PRIVATE MEETING'); meeting('old.hda', project, '2026-08-01T15:00:00Z', 'OLD OUTSIDE PERIOD')
    const unverified = meeting('unverified.hda', project, undefined, 'UNVERIFIED TEXT'); run('UPDATE recordings SET verified=0 WHERE id=?', [unverified])
    const stale = meeting('stale.hda', project, undefined, 'STALE SUMMARY'); run('INSERT INTO transcript_revisions(recording_id,created_at,reason,segment_count,segments) VALUES (?,?,?,?,?)', [stale, now().toISOString(), 'edit', 1, '[]'])
    saveReferenceContext(project, { ...EMPTY_REFERENCE_CONTEXT, background: 'SELECTED PROJECT BACKGROUND' }, 0)
    saveReferenceContext(other, { ...EMPTY_REFERENCE_CONTEXT, background: 'OTHER PRIVATE BACKGROUND' }, 0)
    const state = await service.generate(project, options), input = chat.mock.calls[0][2]
    expect(input).toContain('SELECTED PROJECT BACKGROUND')
    for (const absent of ['OTHER PRIVATE MEETING', 'OTHER PRIVATE BACKGROUND', 'OLD OUTSIDE PERIOD', 'UNVERIFIED TEXT', 'STALE SUMMARY']) expect(input).not.toContain(absent)
    expect(state.coverage).toMatchObject({ recentMeetings: 3, eligibleMeetings: 1, staleSummaries: 1 })
    expect(chat.mock.calls[0][1]).toContain('TWO DIFFERENT MEETINGS')
  })
  it('links verified exact transcript evidence and labels legacy summaries honestly', async () => {
    const id = meeting('quoted.hda')
    run('UPDATE summaries SET outcomes=? WHERE recording_id=?', [JSON.stringify([{ kind: 'decision', text: 'Run a pilot', source: 'transcript', start: 10, evidence: 'Prepare the pilot.' }, { kind: 'open_question', text: 'Invented', source: 'transcript', start: 10, evidence: 'THIS IS NOT IN THE TRANSCRIPT' }]), id])
    const state = await service.generate(project, options), sources = state.briefing!.sources
    expect(sources).toContainEqual(expect.objectContaining({ basis: 'summary', start: null }))
    expect(sources.filter(source => source.basis === 'transcript')).toEqual([expect.objectContaining({ recordingId: id, start: 10, excerpt: 'Prepare the pilot.' })])
    expect(chat.mock.calls[0][2]).not.toContain('THIS IS NOT IN THE TRANSCRIPT')
  })
  it('bounds the context and reports meetings omitted from the recent selection', async () => {
    for (let index = 0; index < 15; index++) meeting(`meeting-${index}.hda`, project, undefined, 'A'.repeat(5000))
    const state = await service.generate(project, options)
    expect(state.coverage).toMatchObject({ eligibleMeetings: 15, includedMeetings: 12 })
    expect(state.briefing?.sources).toHaveLength(12); expect(chat.mock.calls[0][2].length).toBeLessThan(70000)
  })
  it('does not reuse cached claims after a summary or reference context changes', async () => {
    const id = meeting('recent.hda'); await service.generate(project, options)
    run('UPDATE summaries SET text=? WHERE recording_id=?', ['Changed decision.', id])
    expect(service.get(project, options)).toMatchObject({ briefing: null, sourcesChanged: true })
    await service.generate(project, options)
    saveReferenceContext(project, { ...EMPTY_REFERENCE_CONTEXT, terminology: 'Changed preferred spelling' }, 0)
    expect(service.get(project, options)).toMatchObject({ briefing: null, sourcesChanged: true })
    expect(chat).toHaveBeenCalledTimes(2)
  })
  it('includes decisions and questions beyond the opening excerpt of a long summary', async () => {
    meeting('long.hda', project, undefined, 'A'.repeat(5000) + '\n## Decisions\n- Use the revised pilot budget.\n## Open questions\n- Who owns the launch review?')
    run('UPDATE summaries SET outcomes=NULL WHERE recording_id=(SELECT id FROM recordings WHERE filename=?)', ['long.hda'])
    await service.generate(project, options)
    expect(chat.mock.calls[0][2]).toContain('Use the revised pilot budget.')
    expect(chat.mock.calls[0][2]).toContain('Who owns the launch review?')
  })
  it('clears source and destination caches when moving a recording to another project', async () => {
    const id = meeting('recent.hda'); meeting('private.hda', other)
    await service.generate(project, options); await service.generate(other, options)
    assignRecordingProject(id, other)
    expect(queryOne('SELECT key FROM settings WHERE key IN (?,?)', [`project-briefing:${project}:30`, `project-briefing:${other}:30`])).toBeUndefined()
    expect(service.get(project, options).briefing).toBeNull()
  })
  it('deduplicates simultaneous generation and rejects a different concurrent project', async () => {
    meeting('recent.hda'); meeting('other.hda', other)
    let resolve!: (value: string) => void; chat.mockImplementationOnce(() => new Promise<string>(done => { resolve = done }))
    const first = service.generate(project, options), second = service.generate(project, options)
    expect(service.get(project, options).busy).toBe(true)
    await expect(service.generate(other, options)).rejects.toThrow('Another project briefing')
    resolve(result())
    expect((await first).briefing).toEqual((await second).briefing); expect(chat).toHaveBeenCalledTimes(1)
  })
  it('rejects stale completion if sources change while the provider is running', async () => {
    const id = meeting('recent.hda')
    let resolve!: (value: string) => void; chat.mockImplementationOnce(() => new Promise<string>(done => { resolve = done }))
    const pending = service.generate(project, options)
    run('UPDATE summaries SET text=? WHERE recording_id=?', ['A new decision.', id]); resolve(result())
    await expect(pending).rejects.toThrow('Project sources changed')
    expect(service.get(project, options).briefing).toBeNull()
  })
  it('preserves the last successful result and hides provider internals after a failure', async () => {
    meeting('recent.hda'); const before = (await service.generate(project, options)).briefing
    chat.mockRejectedValueOnce(Error('SECRET KEY https://private-provider.example'))
    await expect(service.generate(project, options)).rejects.toThrow('The briefing could not be generated.')
    expect(service.get(project, options).briefing).toEqual(before)
    expect(service.get(project, options).busy).toBe(false)
  })
  it('cancels a running request and allows retrying without replacing the saved result', async () => {
    meeting('recent.hda'); const before = (await service.generate(project, options)).briefing
    chat.mockImplementationOnce((_model, _instructions, _content, signal: AbortSignal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })))
    const pending = service.generate(project, options); service.cancel(project)
    await expect(pending).rejects.toThrow('cancelled')
    expect(service.get(project, options).briefing).toEqual(before)
    await service.generate(project, options); expect(service.get(project, options).busy).toBe(false)
  })
  it('blocks generation during restore review or without eligible recordings', async () => {
    await expect(service.generate(project, options)).rejects.toThrow('No current, summarized recordings')
    meeting('recent.hda'); ai.summaryReady = false; ai.summaryReason = 'Review restored settings first.'
    await expect(service.generate(project, options)).rejects.toThrow('Review restored settings first.')
    expect(chat).not.toHaveBeenCalled()
  })
  it('keeps separate periods and permits generation again after a cancelled maintenance operation', async () => {
    meeting('recent.hda'); await service.generate(project, options)
    expect(service.get(project, { ...options, days: 7 }).briefing).toBeNull()
    await service.stop(); expect(service.get(project, options).canGenerate).toBe(false)
    service.resume(); expect(service.get(project, options).canGenerate).toBe(true)
  })
})

describe('briefing input and citation validation', () => {
  const sources: BriefingSource[] = [1, 2].map(number => ({ number, recordingId: 'meeting-' + number, title: 'Meeting', recordedAt: '2026-11-02T15:00:00Z', basis: 'summary', start: null, excerpt: 'Summary' }))
  it.each([null, {}, { days: 1 }, { days: 30, today: '2026-02-30' }, { ...options, unknown: true }])('rejects malformed options: %j', value => { expect(() => validateBriefingOptions(value)).toThrow() })
  it.each(['not json', result([99]), result([1], true), JSON.stringify({ overview: [], changes: [], decisions: [], questions: [] })])('rejects uncited or invalid provider output', value => { expect(() => parseBriefingContent(value, sources)).toThrow('unsupported briefing') })
  it('allows grounded cross-meeting changes, including a fenced JSON response', () => {
    expect(parseBriefingContent('```json\n' + result([1, 2], true) + '\n```', sources).changes).toHaveLength(1)
    expect(() => parseBriefingContent(result([1, 2], true), sources.map(source => ({ ...source, recordingId: 'same-meeting' })))).toThrow('unsupported briefing')
  })
})
