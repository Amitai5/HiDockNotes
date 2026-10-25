import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, getDetail, initializeDatabase, queryOne, run, upsertRecordingFromDevice } from '../services/database'
import {createProject} from '../services/database'
import {saveReferenceContext} from '../services/reference-context'
import {EMPTY_REFERENCE_CONTEXT} from '../../../src/shared/reference-context'
import { TranscriptionQueue } from '../ai/queue'
import { CredentialVault } from '../ai/credentials'
import { ProcessingError } from '../ai/errors'
import { saveTranscript } from '../ai/processing-store'
import { DEFAULT_AI_SETTINGS, DEFAULT_MODELS, type AISettings, type ChatGPTState } from '../../../src/shared/ai'
import type { BackendObserver, ProcessingInput, ProcessingResult } from '../ai/backend'

interface Pending { input: ProcessingInput; observer: BackendObserver; done: boolean; resolve(value: ProcessingResult): void; reject(error: Error): void }
describe('bounded parallel transcription and summary jobs', () => {
  let settings: AISettings, queue: TranscriptionQueue, requests: Pending[]
  const runner = { run: vi.fn(), stop: vi.fn() }
  let account: ChatGPTState
  const transcript = (id: string): ProcessingResult => ({ segments: [{ id: 'segment-' + id, text: 'A saved transcript.', start: 0, end: 2, speakerId: null, speakerName: null }], speakers: [], duration: 2, summary: null, empty: false })
  const empty: ProcessingResult = { segments: [], speakers: [], duration: 2, summary: null, empty: true }
  function recording(index: number, summarized = false): string {
    const row = upsertRecordingFromDevice({ filename: `parallel-${index}.hda`, size: 200, duration: 2, dateCreated: new Date('2026-10-07T10:00:00Z') })
    run("UPDATE recordings SET file_path='/saved/audio', checksum='verified', verified=1, status='downloaded' WHERE id=?", [row.id])
    if (summarized) { saveTranscript(row.id, transcript(row.id), settings); run("UPDATE recordings SET status='done' WHERE id=?", [row.id]) }
    return row.id
  }
  const active = (kind?: 'transcription' | 'summary') => requests.filter(request => !request.done && (!kind || !!request.input.savedTranscript === (kind === 'summary')))
  beforeEach(() => {
    initializeDatabase(':memory:'); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-07T10:00:00Z'))
    settings = { ...structuredClone(DEFAULT_AI_SETTINGS), maxConcurrentTranscriptions: 2, maxConcurrentSummaries: 2 }
    account = { profiles: [], activeProfileId: 'account-one', connected: true, planEnabled: true, signingIn: false, error: null, welcomePending: false, models: [], offline: false, usageBlocked: false }
    requests = []
    runner.run.mockReset().mockImplementation((input: ProcessingInput, observer: BackendObserver) => new Promise<ProcessingResult>((resolve, reject) => { const request: Pending = { input, observer, done: false, resolve: value => { request.done = true; resolve(value) }, reject: error => { request.done = true; reject(error) } }; requests.push(request) }))
    runner.stop.mockReset().mockImplementation(async (id?: string) => { for (const request of active()) if (!id || request.input.id === id) request.reject(new ProcessingError('Cancelled.')) })
    const vault = new CredentialVault({ isAvailable: () => true, encrypt: value => Buffer.from(value), decrypt: value => value.toString() })
    vault.saveVerified('gemini', 'AQ.fixture', DEFAULT_MODELS.gemini)
    queue = new TranscriptionQueue({ vault, settings: () => structuredClone(settings), dataPath: '/fixture', runner, changed: vi.fn(), activity: vi.fn(), chatgpt: { state: () => account } })
  })
  afterEach(async () => { await queue.stop(); vi.useRealTimers(); closeDatabase() })
  it('captures the destination context before the first worker and preserves it through the first summary',async()=>{
    const project=createProject('ColonyLaw'),id=recording(70)
    run('UPDATE recordings SET project_id=? WHERE id=?',[project.id,id])
    saveReferenceContext(null,{...EMPTY_REFERENCE_CONTEXT,terminology:'Global initial'},0)
    saveReferenceContext(project.id,{...EMPTY_REFERENCE_CONTEXT,terminology:'ColonyLaw initial'},0)
    queue.enqueue(id,true);await vi.advanceTimersByTimeAsync(1)
    const input=active('transcription')[0].input
    expect(input.referenceContext).toMatchObject({globalVersion:1,projects:[{id:project.id,version:1,content:{terminology:'ColonyLaw initial'}}]})
    saveReferenceContext(project.id,{...EMPTY_REFERENCE_CONTEXT,terminology:'Edited during transcription'},1)
    active('transcription')[0].resolve(transcript(id));await vi.advanceTimersByTimeAsync(1)
    expect(active('summary')[0].input.referenceContext).toEqual(input.referenceContext)
    expect(queryOne<{context_snapshot:string}>('SELECT context_snapshot FROM transcription_jobs WHERE recording_id=?',[id])?.context_snapshot).toContain('ColonyLaw initial')
  })
  it('fills transcription slots once per recording and releases a slot before its independent summary starts', async () => {
    const ids = [recording(1), recording(2), recording(3)]
    for (const id of ids) queue.enqueue(id, true)
    await vi.advanceTimersByTimeAsync(1)
    expect(active('transcription')).toHaveLength(2); expect(queue.state().queue?.activeJobs).toHaveLength(2)
    queue.enqueue(ids[0], true); queue.kick(); await vi.advanceTimersByTimeAsync(1)
    expect(requests).toHaveLength(2)
    active('transcription')[0].resolve(transcript(ids[0])); await vi.advanceTimersByTimeAsync(1)
    expect(active('transcription').map(request => request.input.id)).toEqual([ids[1], ids[2]])
    expect(active('summary')).toHaveLength(1)
    expect(active('summary')[0].input).toMatchObject({ id: ids[0], savedTranscript: { segments: [{ text: 'A saved transcript.' }] }, profiles: [], summaryReady: true })
    expect(getDetail(ids[0]).segments).toHaveLength(1)
  })
  it('honors the independent summary limit and reports progress for every active recording', async () => {
    const ids = [recording(1, true), recording(2, true), recording(3, true)]
    for (const id of ids) queue.reprocess(id, 'summarize')
    await vi.advanceTimersByTimeAsync(1)
    expect(active('summary')).toHaveLength(2); expect(queue.state().queue?.waitingSummaries).toBe(1)
    active()[0].observer.stage('summarizing', 0.4, 'First summary')
    const jobs = queue.state().queue!.activeJobs!
    expect(jobs.find(job => job.id === ids[0])).toMatchObject({ progress: 0.4, message: 'First summary', startedAt: '2026-10-07T10:00:00.000Z' })
    expect(jobs.find(job => job.id === ids[1])!.progress).toBe(0)
  })
  it('applies lower limits to new jobs while allowing existing work to finish, and fills newly raised limits', async () => {
    const ids = [recording(1), recording(2), recording(3), recording(4)]
    for (const id of ids) queue.enqueue(id, true)
    await vi.advanceTimersByTimeAsync(1)
    settings.maxConcurrentTranscriptions = 1; queue.kick(); await vi.advanceTimersByTimeAsync(1)
    expect(active()).toHaveLength(2); expect(runner.stop).not.toHaveBeenCalled()
    active()[0].resolve(empty); await vi.advanceTimersByTimeAsync(1)
    expect(requests).toHaveLength(2)
    active()[0].resolve(empty); await vi.advanceTimersByTimeAsync(1)
    expect(active()[0].input.id).toBe(ids[2])
    settings.maxConcurrentTranscriptions = 2; queue.kick(); await vi.advanceTimersByTimeAsync(1)
    expect(active().map(request => request.input.id)).toEqual([ids[2], ids[3]])
  })
  it('does not let a backing-off recording block another ready recording', async () => {
    const ids = [recording(1), recording(2), recording(3)]
    for (const id of ids) queue.enqueue(id, true)
    await vi.advanceTimersByTimeAsync(1)
    active()[0].reject(new ProcessingError('Temporary provider error.', true)); await vi.advanceTimersByTimeAsync(1)
    expect(active().map(request => request.input.id)).toEqual([ids[1], ids[2]])
    expect(getDetail(ids[0]).processing).toMatchObject({ stage: 'queued', attempt: 1 })
  })
  it('deletes only the selected active recording, ignores its late callbacks and leaves other workers running', async () => {
    const first = recording(1), second = recording(2), third = recording(3)
    for (const id of [first, second, third]) queue.enqueue(id, true)
    await vi.advanceTimersByTimeAsync(1)
    const old = active()[0].observer
    await queue.withRecordingPaused(first, async () => { old.checkpoint(transcript(first)); run('DELETE FROM recordings WHERE id=?', [first]) })
    old.stage('transcribing', 1, 'Late'); old.checkpoint(transcript(first)); await vi.advanceTimersByTimeAsync(1)
    expect(runner.stop).toHaveBeenCalledExactlyOnceWith(first)
    expect(active().map(request => request.input.id)).toEqual([second, third])
    expect(queryOne('SELECT id FROM segments WHERE recording_id=?', [first])).toBeUndefined()
  })
  it('cancels each summary bound to an invalidated account without cancelling transcription', async () => {
    settings.chat = { provider: 'chatgpt', model: 'gpt-6.1-sol' }
    const first = recording(1, true), second = recording(2, true), third = recording(3)
    queue.reprocess(first, 'summarize'); queue.reprocess(second, 'summarize'); queue.enqueue(third, true)
    await vi.advanceTimersByTimeAsync(1)
    expect(active('summary')).toHaveLength(2); expect(active('transcription')[0].input.chatgptProfileId).toBeUndefined()
    account.planEnabled = false; account.connected = false; queue.invalidateChatGPTSession('account-one')
    await vi.advanceTimersByTimeAsync(1)
    expect(runner.stop.mock.calls.map(call => call[0]).sort()).toEqual([first, second].sort())
    expect(active().map(request => request.input.id)).toEqual([third])
    for (const id of [first, second]) { expect(getDetail(id).processing).toMatchObject({ stage: 'queued', attempt: 0 }); expect(getDetail(id).segments).toHaveLength(1) }
  })
  it('continues a manually queued transcription into a summary when automatic transcription is off', async () => {
    settings.autoTranscribe = false
    const id = recording(1); queue.enqueue(id, true); await vi.advanceTimersByTimeAsync(1)
    active()[0].resolve(transcript(id)); await vi.advanceTimersByTimeAsync(1)
    expect(active('summary')[0].input.id).toBe(id)
  })
  it('retries a failed summary from its saved transcript without running transcription again', async () => {
    const id = recording(1, true); queue.reprocess(id, 'summarize'); await vi.advanceTimersByTimeAsync(1)
    active()[0].reject(new ProcessingError('Rate limited.', true)); await vi.advanceTimersByTimeAsync(10001)
    expect(requests).toHaveLength(2); expect(requests.every(request => !!request.input.savedTranscript)).toBe(true)
    expect(getDetail(id).segments).toHaveLength(1)
  })
})
