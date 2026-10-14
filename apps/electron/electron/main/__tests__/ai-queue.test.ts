import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, getDetail, initializeDatabase, queryOne, renameRecording, run, upsertRecordingFromDevice } from '../services/database'
import { CredentialVault } from '../ai/credentials'
import { TranscriptionQueue, type ProcessingRunner } from '../ai/queue'
import { DEFAULT_AI_SETTINGS, DEFAULT_MODELS } from '../../../src/shared/ai'
import type { BackendObserver, ProcessingResult } from '../ai/backend'
import { ProcessingError } from '../ai/errors'
import { ChatGPTPlanBlocked } from '../ai/chatgpt-protocol'
import type { ChatGPTState } from '../../../src/shared/ai'
import { saveTranscript } from '../ai/processing-store'

const CLOUD_SETTINGS = { ...DEFAULT_AI_SETTINGS, transcription: { provider: 'gemini' as const, model: 'gemini-3.5-transcribe' } }

describe('persistent single-recording processing queue', () => {
  let queue: TranscriptionQueue | null = null
  let vault: CredentialVault
  beforeEach(() => { initializeDatabase(':memory:'); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-07T10:00:00Z')); vault = new CredentialVault({ isAvailable: () => true, encrypt: value => Buffer.from(value.split('').reverse().join('')), decrypt: value => value.toString().split('').reverse().join('') }) })
  afterEach(async () => { await queue?.stop(); queue = null; vi.useRealTimers(); closeDatabase() })
  function recording(number = 0, verified = true): string {
    const row = upsertRecordingFromDevice({ filename: `call-${number}.hda`, size: 200, duration: 10, dateCreated: new Date('2026-10-07T10:00:00Z') })
    run("UPDATE recordings SET file_path='/saved/audio', checksum='checked', verified=?, status='downloaded' WHERE id=?", [Number(verified), row.id])
    return row.id
  }
  const result: ProcessingResult = { duration: 10, speakers: [], segments: [{ id: 'cb1456e2-a1c3-474f-a037-a3b2a41388e5', start: 0, end: 2, text: 'I will send the plan.', speakerId: null, speakerName: null }], empty: false, summary: { title: 'AI title', summary: 'Send the plan.', actionItems: [{ text: 'Send the plan', start: 0 }] } }
  function create(runner: ProcessingRunner, configured = true): TranscriptionQueue {
    if (configured) vault.saveVerified('gemini', 'AQ.fake-key', DEFAULT_MODELS.gemini)
    queue = new TranscriptionQueue({ vault, settings: () => structuredClone(CLOUD_SETTINGS), dataPath: '/local', runner, changed: vi.fn(), activity: vi.fn() })
    return queue
  }
  it('backfills existing verified downloads and pauses until keys are verified', async () => {
    const id = recording(), unverified = recording(1, false), runner = { run: vi.fn(), stop: vi.fn().mockResolvedValue(undefined) }
    const q = create(runner, false)
    q.start(); await vi.advanceTimersByTimeAsync(1)
    expect(getDetail(id).recording.status).toBe('queued')
    expect(getDetail(unverified).recording.status).toBe('downloaded')
    expect(q.state()).toMatchObject({ ready: false })
    expect(runner.run).not.toHaveBeenCalled()
    expect(() => q.enqueue(unverified, true)).toThrow('verify')
  })
  it('runs exactly one recording at a time and ignores duplicate enqueue requests', async () => {
    const ids = [recording(0), recording(1)]
    const releases: (() => void)[] = []
    const runner = { run: vi.fn(() => new Promise<ProcessingResult>(resolve => releases.push(() => resolve({ ...result, segments: [] })))), stop: vi.fn().mockImplementation(async () => { releases.forEach(release => release()) }) }
    const q = create(runner)
    q.enqueue(ids[0]); q.enqueue(ids[0]); q.enqueue(ids[1]); await vi.advanceTimersByTimeAsync(1)
    expect(runner.run).toHaveBeenCalledTimes(1)
    releases[0](); await vi.advanceTimersByTimeAsync(1)
    expect(runner.run).toHaveBeenCalledTimes(2)
    releases[1](); await vi.advanceTimersByTimeAsync(1)
    expect(ids.map(id => getDetail(id).recording.status)).toEqual(['done', 'done'])
  })
  it('persists transcript, summary and timestamped actions without replacing a manual title', async () => {
    const id = recording()
    renameRecording(id, 'My recording name')
    const q = create({ run: vi.fn().mockImplementation(async (_input, observer: BackendObserver) => { observer.stage('transcribing', 0.5, 'Part 1'); observer.checkpoint(result); return result }), stop: vi.fn().mockResolvedValue(undefined) })
    q.enqueue(id); await vi.advanceTimersByTimeAsync(1)
    const detail = getDetail(id)
    expect(detail.recording).toMatchObject({ status: 'done', title: 'My recording name', summary: 'Send the plan.' })
    expect(detail.segments[0].text).toBe('I will send the plan.')
    expect(detail.actionables[0]).toMatchObject({ text: 'Send the plan', start: 0 })
    expect(JSON.stringify(queryOne('SELECT * FROM transcription_jobs'))).not.toContain('AQ.fake-key')
  })
  it('retries transient errors with persistent backoff and lets the user retry a terminal failure', async () => {
    const id = recording()
    const runner = { run: vi.fn().mockRejectedValueOnce(new ProcessingError('Rate limited.', true)).mockResolvedValue(result), stop: vi.fn().mockResolvedValue(undefined) }
    const q = create(runner)
    q.enqueue(id); await vi.advanceTimersByTimeAsync(1)
    expect(getDetail(id).processing).toMatchObject({ stage: 'queued', attempt: 1, error: 'Rate limited.' })
    await vi.advanceTimersByTimeAsync(10000)
    expect(runner.run).toHaveBeenCalledTimes(2)
    expect(getDetail(id).recording.status).toBe('done')
  })
  it('keeps a completed transcript when summary generation fails and exposes a safe failure', async () => {
    const id = recording()
    const runner = { run: vi.fn().mockImplementation(async (_input, observer: BackendObserver) => { observer.checkpoint(result); throw new Error('private URL key=AQ.secret') }), stop: vi.fn().mockResolvedValue(undefined) }
    const q = create(runner)
    q.enqueue(id); await vi.advanceTimersByTimeAsync(1)
    expect(getDetail(id).segments).toHaveLength(1)
    expect(getDetail(id).processing?.error).not.toContain('AQ.secret')
    expect(getDetail(id).recording.status).toBe('failed')
    runner.run.mockResolvedValue(result)
    q.enqueue(id, true); await vi.advanceTimersByTimeAsync(1)
    expect(getDetail(id).recording.status).toBe('done')
  })
  it('recovers unfinished stages after restart without consuming a retry attempt', () => {
    const id = recording()
    run("INSERT INTO transcription_jobs(id, recording_id, stage, attempt, created_at) VALUES ('job', ?, 'transcribing', 2, '2026-10-07T10:00:00Z')", [id])
    const q = create({ run: vi.fn(), stop: vi.fn().mockResolvedValue(undefined) }, false)
    q.start()
    expect(getDetail(id).processing).toMatchObject({ stage: 'queued', attempt: 1 })
  })
  it('uses an account binding for subscription summaries without passing OAuth tokens to a job', async () => {
    const id = recording()
    vault.saveVerified('gemini', 'AQ.fake-key', DEFAULT_MODELS.gemini)
    const state: ChatGPTState = { profiles: [], activeProfileId: 'account-one', connected: true, planEnabled: true, signingIn: false, error: null, welcomePending: false, models: [], offline: false, usageBlocked: false }
    const runner = { run: vi.fn().mockResolvedValue(result), stop: vi.fn().mockResolvedValue(undefined) }
    queue = new TranscriptionQueue({ vault, settings: () => ({ ...CLOUD_SETTINGS, chat: { provider: 'chatgpt', model: 'gpt-6.1-sol' } }), dataPath: '/local', runner, changed: vi.fn(), activity: vi.fn(), chatgpt: { state: () => state } })
    queue.enqueue(id); await vi.advanceTimersByTimeAsync(1)
    expect(runner.run.mock.calls[0][0]).toMatchObject({ chatgptProfileId: 'account-one', keys: { gemini: 'AQ.fake-key', openai: null } })
    expect(runner.run.mock.calls[0][0]).not.toHaveProperty('accessToken')
    expect(getDetail(id).recording.status).toBe('done')
  })
  it('pauses all plan jobs after a quota error and preserves the current job for explicit resumption', async () => {
    const first = recording(), second = recording(1)
    vault.saveVerified('gemini', 'AQ.fake-key', DEFAULT_MODELS.gemini)
    const state: ChatGPTState = { profiles: [], activeProfileId: 'account-one', connected: true, planEnabled: true, signingIn: false, error: null, welcomePending: false, models: [], offline: false, usageBlocked: false }
    const block = vi.fn((_id, message) => { state.usageBlocked = true; state.error = message })
    const runner = { run: vi.fn().mockRejectedValueOnce(new ChatGPTPlanBlocked('Usage limit reached. Manage usage.')).mockResolvedValue({ ...result, segments: [] }), stop: vi.fn().mockResolvedValue(undefined) }
    queue = new TranscriptionQueue({ vault, settings: () => ({ ...CLOUD_SETTINGS, chat: { provider: 'chatgpt', model: 'gpt-6.1-sol' } }), dataPath: '/local', runner, changed: vi.fn(), activity: vi.fn(), chatgpt: { state: () => state, block } })
    queue.enqueue(first); queue.enqueue(second); await vi.advanceTimersByTimeAsync(30000)
    expect(runner.run).toHaveBeenCalledTimes(1)
    expect(getDetail(first).processing).toMatchObject({ stage: 'queued', attempt: 0 })
    expect(getDetail(second).recording.status).toBe('queued')
    expect(queue.state()).toMatchObject({ ready: false, reason: 'Usage limit reached. Manage usage.' })
    state.usageBlocked = false; state.error = null; queue.kick(); await vi.advanceTimersByTimeAsync(1)
    expect(runner.run.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(getDetail(first).recording.status).toBe('done')
  })
  it('requeues an interrupted account session without using a retry or discarding its transcript', async () => {
    const id = recording()
    vault.saveVerified('gemini', 'AQ.fake-key', DEFAULT_MODELS.gemini)
    const state: ChatGPTState = { profiles: [], activeProfileId: 'account-one', connected: true, planEnabled: true, signingIn: false, error: null, welcomePending: false, models: [], offline: false, usageBlocked: false }
    let cancel: () => void = () => undefined
    const runner = { run: vi.fn((_input, observer: BackendObserver) => { observer.checkpoint(result); return new Promise<ProcessingResult>((_resolve, reject) => { cancel = () => reject(new ProcessingError('Cancelled')) }) }), stop: vi.fn(async () => cancel()) }
    queue = new TranscriptionQueue({ vault, settings: () => ({ ...CLOUD_SETTINGS, chat: { provider: 'chatgpt', model: 'gpt-6.1-sol' } }), dataPath: '/local', runner, changed: vi.fn(), activity: vi.fn(), chatgpt: { state: () => state } })
    queue.enqueue(id); await vi.advanceTimersByTimeAsync(1)
    queue.invalidateChatGPTSession('unrelated-account')
    expect(runner.stop).not.toHaveBeenCalled()
    state.connected = false; state.planEnabled = false
    queue.invalidateChatGPTSession('account-one'); await vi.advanceTimersByTimeAsync(1)
    expect(runner.stop).toHaveBeenCalledTimes(1)
    expect(getDetail(id).processing).toMatchObject({ stage: 'queued', attempt: 0, error: null })
    expect(getDetail(id).segments).toHaveLength(1)
    expect(runner.run).toHaveBeenCalledTimes(1)
  })
  it('transcribes locally without keys and later queues only the missing summary after setup', async () => {
    const id = recording()
    const runner = { run: vi.fn().mockResolvedValueOnce({ ...result, summary: null }).mockResolvedValue(result), stop: vi.fn().mockResolvedValue(undefined) }
    queue = new TranscriptionQueue({ vault, settings: () => structuredClone(DEFAULT_AI_SETTINGS), dataPath: '/local', runner, changed: vi.fn(), activity: vi.fn() })
    queue.enqueue(id); await vi.advanceTimersByTimeAsync(1)
    expect(queue.state()).toMatchObject({ ready: true, summaryReady: false })
    expect(runner.run.mock.calls[0][0]).toMatchObject({ keys: { gemini: null, openai: null }, summaryReady: false })
    expect(getDetail(id).recording.status).toBe('done')
    expect(queryOne<{ summary_pending: number }>('SELECT summary_pending FROM transcription_jobs')?.summary_pending).toBe(1)
    expect(queue.enqueuePending()).toBe(0)
    vault.saveVerified('gemini', 'AQ.fake-key', DEFAULT_MODELS.gemini)
    expect(queue.enqueuePending()).toBe(1); await vi.advanceTimersByTimeAsync(1)
    expect(getDetail(id).recording.summary).toBe('Send the plan.')
    expect(queryOne<{ summary_pending: number }>('SELECT summary_pending FROM transcription_jobs')?.summary_pending).toBe(0)
    expect(queue.enqueuePending()).toBe(0)
  })
  it('exposes the active recording and waiting positions instead of showing every job as queued', async () => {
    const first = recording(), second = recording(1)
    const releases: (() => void)[] = []
    const runner = { run: vi.fn(() => new Promise<ProcessingResult>(resolve => releases.push(() => resolve({ ...result, segments: [] })))), stop: vi.fn(async () => releases.forEach(release => release())) }
    const q = create(runner)
    q.enqueue(first); q.enqueue(second); await vi.advanceTimersByTimeAsync(1)
    expect(q.state().queue).toMatchObject({ waiting: 1, active: { id: first, stage: 'converting', message: 'Starting the background processor…', startedAt: '2026-10-07T10:00:00.000Z' } })
    expect(getDetail(first).recording.queuePosition).toBeNull()
    expect(getDetail(second).recording.queuePosition).toBe(1)
    releases[0](); await vi.advanceTimersByTimeAsync(1)
    releases[1](); await vi.advanceTimersByTimeAsync(1)
    expect(q.state().queue).toEqual({ waiting: 0, waitingTranscriptions: 0, waitingSummaries: 0, reviewPaused: false, active: null })
  })
  it('recovers when reading settings during job preparation fails instead of leaving the active latch stuck', async () => {
    const id = recording(), runner = { run: vi.fn().mockResolvedValue({ ...result, summary: null }), stop: vi.fn().mockResolvedValue(undefined) }
    let reads = 0
    queue = new TranscriptionQueue({ vault, settings: () => { if (++reads === 3) throw new ProcessingError('Preferences temporarily unavailable.', true); return structuredClone(DEFAULT_AI_SETTINGS) }, dataPath: '/local', runner, changed: vi.fn(), activity: vi.fn() })
    queue.enqueue(id); await vi.advanceTimersByTimeAsync(1)
    expect(getDetail(id).processing).toMatchObject({ stage: 'queued', attempt: 1, error: 'Preferences temporarily unavailable.' })
    await vi.advanceTimersByTimeAsync(10000)
    expect(runner.run).toHaveBeenCalledOnce()
    expect(getDetail(id).recording.status).toBe('done')
  })
  it('recovers only verified jobs affected by the fixed legacy Whisper timing error', () => {
    const affected = recording(), unrelated = recording(1), unverified = recording(2, false), completed = recording(3)
    for (const [id, stage, error] of [[affected, 'failed', 'Local Whisper returned invalid segment timestamps. Retry the recording.'], [unrelated, 'failed', 'The saved audio changed after verification.'], [unverified, 'failed', 'Local Whisper returned invalid segment timestamps. Retry the recording.'], [completed, 'done', null]] as const) {
      run('INSERT INTO transcription_jobs(id, recording_id, stage, error, created_at) VALUES (?, ?, ?, ?, ?)', [id, id, stage, error, '2026-10-07T10:00:00Z'])
      run('UPDATE recordings SET status=? WHERE id=?', [stage, id])
    }
    const activity = vi.fn()
    queue = new TranscriptionQueue({ vault, settings: () => structuredClone(DEFAULT_AI_SETTINGS), dataPath: '/local', runner: { run: vi.fn(), stop: vi.fn().mockResolvedValue(undefined) }, changed: vi.fn(), activity })
    queue.start()
    expect(getDetail(affected).processing).toMatchObject({ stage: 'queued', attempt: 0, error: null })
    expect(getDetail(unrelated).recording.status).toBe('failed')
    expect(getDetail(unverified).recording.status).toBe('failed')
    expect(getDetail(completed).recording.status).toBe('done')
    expect(activity).toHaveBeenCalledWith('info', expect.stringContaining('1 recording'))
  })
  it.each(['automatic-off', 'cloud-selected'])('leaves failed local jobs for explicit retry when %s', scenario => {
    const id = recording()
    run("INSERT INTO transcription_jobs(id, recording_id, stage, error, created_at) VALUES ('job', ?, 'failed', 'Local Whisper returned invalid segment timestamps. Retry the recording.', '2026-10-07T10:00:00Z')", [id])
    run("UPDATE recordings SET status='failed' WHERE id=?", [id])
    const settings = scenario === 'automatic-off' ? { ...DEFAULT_AI_SETTINGS, autoTranscribe: false } : CLOUD_SETTINGS
    queue = new TranscriptionQueue({ vault, settings: () => structuredClone(settings), dataPath: '/local', runner: { run: vi.fn(), stop: vi.fn().mockResolvedValue(undefined) }, changed: vi.fn(), activity: vi.fn() })
    queue.start()
    expect(getDetail(id).recording.status).toBe('failed')
  })
  it('resummarizes without a transcription key or local audio and never touches transcription settings', async () => {
    const id = recording()
    saveTranscript(id, result, DEFAULT_AI_SETTINGS)
    run("UPDATE recordings SET file_path=NULL,verified=0,status='done' WHERE id=?", [id])
    vault.saveVerified('gemini', 'AQ.fake-key', DEFAULT_MODELS.gemini)
    const runner = { run: vi.fn().mockResolvedValue({ ...result, transcriptChanged: false }), stop: vi.fn().mockResolvedValue(undefined) }
    queue = new TranscriptionQueue({ vault, settings: () => ({ ...CLOUD_SETTINGS, transcription: { provider: 'openai', model: 'whisper-1' } }), dataPath: '/local', runner, changed: vi.fn(), activity: vi.fn() })
    expect(queue.state().ready).toBe(false)
    queue.reprocess(id, 'summarize'); await vi.advanceTimersByTimeAsync(1)
    expect(runner.run.mock.calls[0][0]).toMatchObject({ savedTranscript: { segments: [{ text: 'I will send the plan.' }] }, keys: { gemini: 'AQ.fake-key', openai: null }, profiles: [] })
    expect(getDetail(id).recording.status).toBe('done')
    expect(queryOne('SELECT provider,model FROM transcripts WHERE recording_id=?', [id])).toEqual({ provider: 'local', model: DEFAULT_AI_SETTINGS.transcription.model })
  })
  it('persists a fresh retranscription generation across retries and rejects duplicate regeneration', async () => {
    const id = recording()
    const runner = { run: vi.fn().mockRejectedValueOnce(new ProcessingError('Transient error.', true)).mockResolvedValue(result), stop: vi.fn().mockResolvedValue(undefined) }
    const q = create(runner)
    q.reprocess(id, 'transcribe')
    expect(() => q.reprocess(id, 'transcribe')).toThrow('already processing')
    const generation = queryOne<{ generation: string }>('SELECT generation FROM transcription_jobs')!.generation
    expect(generation).toMatch(/^[\da-f-]{36}$/)
    await vi.advanceTimersByTimeAsync(1); await vi.advanceTimersByTimeAsync(10000)
    expect(runner.run.mock.calls.map(call => call[0].generation)).toEqual([generation, generation])
    expect(getDetail(id).recording.summary).toBe('Send the plan.')
    q.reprocess(id, 'transcribe')
    expect(queryOne<{ generation: string }>('SELECT generation FROM transcription_jobs')!.generation).not.toBe(generation)
  })
  it('keeps the previous notes available when regeneration fails', async () => {
    const id = recording()
    saveTranscript(id, result, DEFAULT_AI_SETTINGS)
    run("INSERT INTO summaries(id,recording_id,text) VALUES ('existing',?,'Last good summary')", [id])
    const q = create({ run: vi.fn().mockRejectedValue(new ProcessingError('Provider unavailable.')), stop: vi.fn().mockResolvedValue(undefined) })
    q.reprocess(id, 'summarize')
    expect(getDetail(id).recording.summary).toBe('Last good summary')
    await vi.advanceTimersByTimeAsync(1)
    expect(getDetail(id).recording).toMatchObject({ status: 'failed', summary: 'Last good summary' })
    expect(getDetail(id).segments).toHaveLength(1)
  })
  it('does not queue a retranscription without a configured summary provider', () => {
    const id = recording()
    queue = new TranscriptionQueue({ vault, settings: () => DEFAULT_AI_SETTINGS, dataPath: '/local', runner: { run: vi.fn(), stop: vi.fn().mockResolvedValue(undefined) }, changed: vi.fn(), activity: vi.fn() })
    expect(() => queue!.reprocess(id, 'transcribe')).toThrow('summaries')
    expect(getDetail(id).recording.status).toBe('downloaded')
  })
  it('recovers an interrupted retranscription with the same persisted generation after restart', () => {
    const id = recording()
    run("INSERT INTO transcription_jobs(id,recording_id,stage,attempt,created_at,mode,generation) VALUES ('job',?,'transcribing',2,'2026-10-07T10:00:00Z','transcribe','saved-generation')", [id])
    const q = create({ run: vi.fn(), stop: vi.fn().mockResolvedValue(undefined) }, false)
    q.start()
    expect(queryOne('SELECT stage,attempt,mode,generation FROM transcription_jobs')).toEqual({ stage: 'queued', attempt: 1, mode: 'transcribe', generation: 'saved-generation' })
  })
  it('ignores late worker callbacks while deleting the active recording and starts other jobs afterwards', async () => {
    const first = recording(), second = recording(1)
    let callbacks: BackendObserver | undefined, finish: (() => void) | undefined
    const runner = { run: vi.fn((_input, observer: BackendObserver) => { callbacks = observer; return new Promise<ProcessingResult>(resolve => { finish = () => resolve(result) }) }), stop: vi.fn(async () => finish?.()) }
    const q = create(runner)
    q.enqueue(first); q.enqueue(second); await vi.advanceTimersByTimeAsync(1)
    const old = callbacks!
    await q.withRecordingPaused(first, async () => {
      old.stage('summarizing', 1, 'stale message'); old.checkpoint(result)
      expect(queryOne('SELECT id FROM segments WHERE recording_id=?', [first])).toBeUndefined()
      run('DELETE FROM recordings WHERE id=?', [first])
    })
    old.checkpoint(result)
    await vi.advanceTimersByTimeAsync(1)
    expect(runner.run).toHaveBeenCalledTimes(2)
    expect(queryOne('SELECT id FROM recordings WHERE id=?', [first])).toBeUndefined()
  })
  it('opens a local review session without starting any existing or newly requested AI work', async () => {
    const id = recording(), runner = { run: vi.fn(), stop: vi.fn().mockResolvedValue(undefined) }
    run("INSERT INTO transcription_jobs(id,recording_id,stage,created_at) VALUES ('pending',?,'queued','2026-10-07T10:00:00Z')", [id])
    queue = new TranscriptionQueue({ vault, settings: () => DEFAULT_AI_SETTINGS, dataPath: '/local', runner, reviewMode: true, changed: vi.fn(), activity: vi.fn() })
    queue.start(); queue.kick(); await vi.advanceTimersByTimeAsync(10000)
    expect(runner.run).not.toHaveBeenCalled()
    expect(queue.state()).toMatchObject({ ready: false, summaryReady: false, reason: 'Background processing is paused. Resume processing to continue.' })
    expect(() => queue!.enqueue(id, true)).toThrow('paused')
    expect(() => queue!.reprocess(id, 'summarize')).toThrow('paused')
    expect(getDetail(id).recording.hasAudio).toBe(true)
  })
  it('resumes a review session only after confirmed consent and then starts pending jobs', async () => {
    const id = recording(), runner = { run: vi.fn(async () => result), stop: vi.fn(async () => undefined) }
    queue = new TranscriptionQueue({ vault, settings: () => DEFAULT_AI_SETTINGS, dataPath: '/local', runner, reviewMode: true, changed: vi.fn(), activity: vi.fn() })
    run("INSERT INTO transcription_jobs(id,recording_id,stage,created_at) VALUES ('pending',?,'queued','2026-10-07T10:00:00Z')", [id])
    queue.start()
    expect(() => queue!.resumeReview(false)).toThrow('Confirm')
    await vi.advanceTimersByTimeAsync(1)
    expect(runner.run).not.toHaveBeenCalled()
    queue.resumeReview(true); await vi.advanceTimersByTimeAsync(1)
    expect(runner.run).toHaveBeenCalledOnce()
    expect(queue.state().queue?.reviewPaused).toBe(false)
  })
  it('distinguishes queued summary jobs and cancels them without discarding results or other jobs', () => {
    const first = recording(), second = recording(1), q = create({ run: vi.fn(), stop: vi.fn(async () => undefined) }, false)
    saveTranscript(first, result, DEFAULT_AI_SETTINGS)
    run("INSERT INTO summaries(id,recording_id,text) VALUES ('saved',?,'Saved notes')", [first])
    run("INSERT INTO transcription_jobs(id,recording_id,stage,created_at,mode) VALUES ('summary-job',?,'queued','2026-10-07T10:00:00Z','summarize'),('audio-job',?,'queued','2026-10-07T10:00:00Z','process')", [first, second])
    expect(q.state().queue).toMatchObject({ waiting: 2, waitingSummaries: 1, waitingTranscriptions: 1, active: null })
    expect(q.cancelQueuedSummaries()).toBe(1)
    expect(getDetail(first).recording).toMatchObject({ status: 'done', summary: 'Saved notes' })
    expect(getDetail(first).segments).toHaveLength(1)
    expect(queryOne("SELECT stage FROM transcription_jobs WHERE id='audio-job'")).toEqual({ stage: 'queued' })
    expect(q.cancelQueuedSummaries()).toBe(0)
  })
})
