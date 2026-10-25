import { randomUUID } from 'node:crypto'
import type { AISettings, AIState, ChatGPTState, TranscriptionQueueView } from '../../../src/shared/ai'
import type { RecordingReprocessMode } from '../../../src/shared/meeting'
import { queryAll, queryOne, run, runInTransaction, type Recording } from '../services/database'
import type { CredentialVault } from './credentials'
import type { BackendObserver, ProcessingInput, ProcessingResult } from './backend'
import { ProcessingError, safeProcessingError } from './errors'
import { voiceCandidates } from './voices'
import { savedTranscript, saveProcessingResult, saveTranscript } from './processing-store'
import { hasTranscriptCorrections, stageTranscriptCandidate } from '../services/transcript-revisions'
import { repairRecordingSpeakers } from './speaker-repair'
import { ChatGPTPlanBlocked } from './chatgpt-protocol'
import { referenceContextSnapshot } from '../services/reference-context'

export interface ProcessingRunner { run(input: ProcessingInput, observer: BackendObserver): Promise<ProcessingResult>; stop(recordingId?: string): Promise<void> }
interface QueueDependencies { vault: CredentialVault; settings(): AISettings; dataPath: string; runner: ProcessingRunner; changed(): void; activity(type: 'info' | 'success' | 'warning' | 'error', message: string): void; now?: () => Date; reviewMode?: boolean; chatgpt?: { state(): ChatGPTState; block?(id: string, message: string): void } }
interface Job { recording_id: string; attempt: number; next_attempt_at: string | null; mode: 'process' | RecordingReprocessMode; generation: string | null; context_snapshot: string | null }
interface ActiveTask { lane: 'transcription' | 'summary'; startedAt: string; chatgptProfileId?: string; sessionCancelled: boolean; settlement: Promise<void> }
const REVIEW_PAUSED_MESSAGE = 'Background processing is paused. Resume processing to continue.'

export class TranscriptionQueue {
  private readonly running = new Map<string, ActiveTask>()
  private stopped = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly now: () => Date
  private readonly paused = new Set<string>()
  private reviewPaused: boolean
  constructor(private readonly dependencies: QueueDependencies) { this.now = dependencies.now ?? (() => new Date()); this.reviewPaused = !!dependencies.reviewMode }
  state(): AIState {
    const settings = this.dependencies.settings()
    const providers = (['gemini', 'openai'] as const).map(p => this.dependencies.vault.state(p))
    const chatgpt = this.dependencies.chatgpt?.state()
    const transcriptionMissing = settings.transcription.provider !== 'local' && !providers.find(item => item.provider === settings.transcription.provider)?.verified
    const subscriptionMissing = settings.chat.provider === 'chatgpt' && !chatgpt?.planEnabled
    const summaryReason = subscriptionMissing ? 'Continue with ChatGPT in Settings and authorize plan usage for summaries.' : settings.chat.provider === 'chatgpt' && chatgpt?.usageBlocked ? chatgpt.error ?? 'ChatGPT plan requests are paused. Open Manage usage in Settings.' : settings.chat.provider !== 'chatgpt' && !providers.find(item => item.provider === settings.chat.provider)?.verified ? `Verify ${settings.chat.provider === 'gemini' ? 'Gemini' : 'OpenAI'} in Settings for summaries and action items.` : null
    const reason = transcriptionMissing ? `Verify ${settings.transcription.provider === 'gemini' ? 'Gemini' : 'OpenAI'} in Settings to start transcription.` : null
    const paused = this.reviewPaused ? REVIEW_PAUSED_MESSAGE : null
    return { settings, providers, ready: !reason && !paused, reason: paused ?? reason, chatgpt, summaryReady: !summaryReason && !paused, summaryReason: paused ?? summaryReason, queue: this.queueView() }
  }
  private queueView(): TranscriptionQueueView {
    const activeJobs = queryAll<NonNullable<TranscriptionQueueView['active']>>("SELECT r.id, COALESCE(r.title,r.filename) AS title, j.stage, j.mode, j.progress, j.message FROM transcription_jobs j JOIN recordings r ON r.id=j.recording_id WHERE j.stage NOT IN ('queued','done','empty','failed') ORDER BY j.created_at")
    const waiting = queryOne<{ transcriptions: number; summaries: number }>("SELECT count(CASE WHEN mode<>'summarize' THEN 1 END) AS transcriptions,count(CASE WHEN mode='summarize' THEN 1 END) AS summaries FROM transcription_jobs WHERE stage='queued'")!
    return { waiting: waiting.transcriptions + waiting.summaries, waitingTranscriptions: waiting.transcriptions, waitingSummaries: waiting.summaries, reviewPaused: this.reviewPaused, active: activeJobs[0] ? { ...activeJobs[0], startedAt: this.running.get(activeJobs[0].id)?.startedAt ?? null } : null, activeJobs: activeJobs.map(active => ({ ...active, startedAt: this.running.get(active.id)?.startedAt ?? null })) }
  }
  /** Only a confirmed in-app action can resume this session's paused jobs. */
  resumeReview(confirmed: boolean): void {
    if (confirmed !== true) throw new Error('Confirm the selected providers before resuming processing.')
    if (!this.reviewPaused) return
    this.reviewPaused = false
    run("DELETE FROM settings WHERE key='restore-review-required'")
    this.dependencies.activity('info', 'Background processing resumed with the selected providers after confirmation.')
    this.enqueuePending(); this.kick(); this.dependencies.changed()
  }
  /** Cancels only waiting summary refreshes and preserves all saved results. */
  cancelQueuedSummaries(): number {
    const rows = queryAll<{ recording_id: string }>("SELECT recording_id FROM transcription_jobs WHERE stage='queued' AND mode='summarize'")
    runInTransaction(() => {
      for (const row of rows) {
        run("UPDATE transcription_jobs SET stage='done',progress=1,summary_pending=0,error=NULL,next_attempt_at=NULL,message='Summary refresh cancelled. Saved transcript and notes were kept.' WHERE recording_id=? AND stage='queued' AND mode='summarize'", [row.recording_id])
        run("UPDATE recordings SET status='done' WHERE id=?", [row.recording_id])
      }
    })
    if (rows.length) { this.dependencies.activity('info', `Cancelled ${rows.length} waiting summary refresh${rows.length === 1 ? '' : 'es'}. Saved recordings and notes were kept.`); this.dependencies.changed() }
    return rows.length
  }
  start(): void {
    this.stopped = false
    const settings = this.dependencies.settings()
    const recovered = settings.autoTranscribe && settings.transcription.provider === 'local' ? queryAll<{ id: string }>("SELECT r.id FROM recordings r JOIN transcription_jobs j ON j.recording_id=r.id WHERE j.stage='failed' AND j.error='Local Whisper returned invalid segment timestamps. Retry the recording.' AND r.verified=1 AND r.file_path IS NOT NULL AND r.checksum IS NOT NULL") : []
    runInTransaction(() => {
      for (const recording of recovered) run("UPDATE transcription_jobs SET stage='queued', progress=0, attempt=0, next_attempt_at=NULL, error=NULL, message='Resuming with the local Whisper timestamp fix…' WHERE recording_id=?", [recording.id])
      run("UPDATE transcription_jobs SET stage='queued', progress=0, message='Resuming after restart…', attempt=MAX(0,attempt-1) WHERE stage NOT IN ('queued','done','empty','failed')")
      run("UPDATE recordings SET status='queued' WHERE id IN (SELECT recording_id FROM transcription_jobs WHERE stage='queued')")
    })
    if (recovered.length) { this.dependencies.activity('info', `Resuming ${recovered.length} recording${recovered.length === 1 ? '' : 's'} affected by the local Whisper timestamp issue.`); this.dependencies.changed() }
    this.enqueuePending()
    this.kick()
    if (this.reviewPaused) this.dependencies.activity('info', 'Background processing is paused. Resume from Library, a recording, or Settings after confirming the selected providers, or cancel waiting summary refreshes.')
  }
  enqueue(id: string, manual = false): void {
    if (this.reviewPaused) { if (manual) throw new Error(REVIEW_PAUSED_MESSAGE); return }
    if (this.paused.has(id) || queryOne('SELECT recording_id FROM recording_deletions WHERE recording_id=?', [id])) { if (manual) throw new Error('Finish deleting this recording before processing it.'); return }
    const recording = queryOne<Recording>('SELECT * FROM recordings WHERE id=?', [id])
    const existing = queryOne<{ stage: string; summary_pending: number; mode: string }>('SELECT stage, summary_pending, mode FROM transcription_jobs WHERE recording_id=?', [id])
    const addSummary = existing?.stage === 'done' && !!existing.summary_pending && this.state().summaryReady
    if (!recording || (existing?.mode !== 'summarize' && !addSummary && (!recording.verified || !recording.file_path || !recording.checksum))) { if (manual) throw new Error('Download and verify the local audio before processing it.'); return }
    if (!manual && !this.dependencies.settings().autoTranscribe) return
    if (existing && !['failed', 'empty'].includes(existing.stage) && !addSummary) return
    runInTransaction(() => {
      run("INSERT INTO transcription_jobs(id, recording_id, stage, created_at) VALUES (?, ?, 'queued', ?) ON CONFLICT(recording_id) DO UPDATE SET stage='queued', attempt=0, next_attempt_at=NULL, progress=0, error=NULL, message='Waiting to process…', mode=CASE WHEN ?=1 THEN 'summarize' ELSE transcription_jobs.mode END", [randomUUID(), id, this.now().toISOString(), Number(addSummary)])
      run("UPDATE recordings SET status='queued' WHERE id=?", [id])
    })
    this.dependencies.changed()
    this.kick()
  }
  enqueuePending(manual = false): number {
    if (this.reviewPaused) { if (manual) throw new Error(REVIEW_PAUSED_MESSAGE); return 0 }
    if (!manual && !this.dependencies.settings().autoTranscribe) return 0
    const rows = queryAll<{ id: string }>("SELECT r.id FROM recordings r LEFT JOIN transcription_jobs j ON j.recording_id=r.id WHERE r.verified=1 AND r.file_path IS NOT NULL AND r.checksum IS NOT NULL AND (j.id IS NULL OR (j.stage='done' AND j.summary_pending=1 AND ?=1)) ORDER BY r.date_recorded", [Number(this.state().summaryReady)])
    for (const row of rows) this.enqueue(row.id, manual)
    return rows.length
  }
  reprocess(id: string, mode: RecordingReprocessMode): void {
    if (queryOne('SELECT recording_id FROM transcript_candidates WHERE recording_id=?', [id])) throw new Error('Review or discard the new transcription before processing this recording again.')
    if (this.reviewPaused) throw new Error(REVIEW_PAUSED_MESSAGE)
    if (this.paused.has(id) || queryOne('SELECT recording_id FROM recording_deletions WHERE recording_id=?', [id])) throw new Error('Finish deleting this recording before processing it.')
    const recording = queryOne<Recording>('SELECT * FROM recordings WHERE id=?', [id])
    if (!recording) throw new Error('Recording was not found.')
    const existing = queryOne<{ stage: string }>('SELECT stage FROM transcription_jobs WHERE recording_id=?', [id])
    if (existing && !['done', 'empty', 'failed'].includes(existing.stage)) throw new Error('This recording is already processing or queued.')
    const state = this.state()
    if (!state.summaryReady) throw new Error(state.summaryReason ?? 'Configure a summary provider in Settings.')
    if (mode === 'summarize') {
      if (!queryOne('SELECT id FROM segments WHERE recording_id=? LIMIT 1', [id])) throw new Error('Transcribe this recording before generating a summary.')
    } else if (!recording.verified || !recording.file_path || !recording.checksum) throw new Error('Download and verify the local audio before retranscribing it.')
    else if (!state.ready) throw new Error(state.reason ?? 'Configure a transcription provider in Settings.')
    runInTransaction(() => {
      run("INSERT INTO transcription_jobs(id,recording_id,stage,created_at,mode,generation) VALUES (?,?,'queued',?,?,?) ON CONFLICT(recording_id) DO UPDATE SET stage='queued',attempt=0,next_attempt_at=NULL,progress=0,error=NULL,message='Waiting to regenerate…',mode=excluded.mode,generation=excluded.generation,context_snapshot=NULL", [randomUUID(), id, this.now().toISOString(), mode, mode === 'transcribe' ? randomUUID() : null])
      run("UPDATE recordings SET status='queued' WHERE id=?", [id])
    })
    this.dependencies.changed(); this.kick()
  }
  kick(): void {
    if (this.stopped || this.reviewPaused) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => { this.timer = null; try { this.tick() } catch { this.dependencies.activity('error', 'The processing queue could not start. Check Settings and retry.') } }, 0)
  }
  async stop(): Promise<void> {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    await this.dependencies.runner.stop()
    await Promise.all([...this.running.values()].map(task => task.settlement))
  }
  /** Stops only this recording's AI worker while a confirmed deletion settles. */
  async withRecordingPaused<T>(id: string, operation: () => Promise<T>): Promise<T> {
    if (this.paused.has(id)) throw new Error('This recording is already being changed.')
    this.paused.add(id)
    const active = this.running.get(id)
    try { if (active) { await this.dependencies.runner.stop(id); await active.settlement }; return await operation() }
    finally {
      if (active && queryOne('SELECT id FROM recordings WHERE id=?', [id])) runInTransaction(() => {
        run("UPDATE transcription_jobs SET stage='queued',attempt=MAX(0,attempt-1),next_attempt_at=NULL,error=NULL,message='Waiting to resume…' WHERE recording_id=? AND stage NOT IN ('done','empty','failed')", [id])
        run("UPDATE recordings SET status='queued' WHERE id=? AND id IN (SELECT recording_id FROM transcription_jobs WHERE stage='queued')", [id])
      })
      this.paused.delete(id); this.kick()
    }
  }
  invalidateChatGPTSession(profileId: string): void {
    for (const [id, task] of this.running) {
      if (task.chatgptProfileId !== profileId) continue
      task.sessionCancelled = true
      void this.dependencies.runner.stop(id).catch(() => this.dependencies.activity('warning', 'The old ChatGPT processing session could not close immediately.'))
    }
  }
  private tick(): void {
    if (this.stopped || this.reviewPaused) return
    const state = this.state(), limits = { transcription: state.settings.maxConcurrentTranscriptions, summary: state.settings.maxConcurrentSummaries }
    const counts = { transcription: 0, summary: 0 }
    for (const task of this.running.values()) counts[task.lane]++
    const jobs = queryAll<Job>("SELECT recording_id, attempt, next_attempt_at, mode, generation, context_snapshot FROM transcription_jobs WHERE stage='queued' AND recording_id NOT IN (SELECT recording_id FROM recording_deletions) AND ((mode='summarize' AND ?=1) OR (mode='transcribe' AND ?=1 AND ?=1) OR (mode='process' AND ?=1)) ORDER BY COALESCE(next_attempt_at,created_at), created_at", [Number(state.summaryReady), Number(state.ready), Number(state.summaryReady), Number(state.ready)])
    let wake = Infinity
    for (const job of jobs) {
      const lane = job.mode === 'summarize' ? 'summary' : 'transcription'
      if (this.running.has(job.recording_id) || this.paused.has(job.recording_id) || counts[lane] >= limits[lane]) continue
      const wait = job.next_attempt_at ? Date.parse(job.next_attempt_at) - this.now().getTime() : 0
      if (wait > 0) { wake = Math.min(wake, wait); continue }
      const task: ActiveTask = { lane, startedAt: this.now().toISOString(), sessionCancelled: false, settlement: Promise.resolve() }
      this.running.set(job.recording_id, task); counts[lane]++
      task.settlement = this.processJob(job, task).catch(() => this.dependencies.activity('error', 'The processing result could not be saved. Check disk space and retry.')).finally(() => {
        if (this.running.get(job.recording_id) === task) this.running.delete(job.recording_id)
        if (!this.stopped) { this.dependencies.changed(); this.kick() }
      })
    }
    if (Number.isFinite(wake)) this.timer = setTimeout(() => { this.timer = null; this.kick() }, Math.min(wake, 2147483647))
  }
  private async processJob(job: Job, task: ActiveTask): Promise<void> {
    const recording = queryOne<Recording>('SELECT * FROM recordings WHERE id=?', [job.recording_id])
    if (!recording || job.mode !== 'summarize' && (!recording.file_path || !recording.checksum || !recording.verified)) {
      run("UPDATE transcription_jobs SET stage='failed', error='The verified local audio is unavailable.' WHERE recording_id=?", [job.recording_id])
      run("UPDATE recordings SET status='failed' WHERE id=?", [job.recording_id]); this.dependencies.changed(); return
    }
    let chatgptProfileId: string | undefined
    try {
      const initialStage = job.mode === 'summarize' ? 'summarizing' : 'converting'
      runInTransaction(() => { run("UPDATE transcription_jobs SET stage=?, progress=0, attempt=attempt+1, error=NULL, next_attempt_at=NULL, message='Starting the background processor…' WHERE recording_id=?", [initialStage, job.recording_id]); run('UPDATE recordings SET status=? WHERE id=?', [initialStage, job.recording_id]) })
      this.dependencies.changed()
      const settings = this.dependencies.settings()
      const reference = job.context_snapshot ? JSON.parse(job.context_snapshot) : referenceContextSnapshot(recording.project_id)
      if(!job.context_snapshot)run('UPDATE transcription_jobs SET context_snapshot=? WHERE recording_id=?',[JSON.stringify(reference),recording.id])
      const reviewTranscript = job.mode !== 'summarize' && hasTranscriptCorrections(recording.id)
      const summaryReady = job.mode === 'summarize' && (this.state().summaryReady ?? true)
      chatgptProfileId = summaryReady && settings.chat.provider === 'chatgpt' ? this.dependencies.chatgpt?.state().activeProfileId ?? undefined : undefined
      task.chatgptProfileId = chatgptProfileId
      const keys: ProcessingInput['keys'] = { gemini: null, openai: null }
      for (const provider of new Set([...(job.mode === 'summarize' || settings.transcription.provider === 'local' ? [] : [settings.transcription.provider]), ...(!summaryReady || settings.chat.provider === 'chatgpt' ? [] : [settings.chat.provider])])) keys[provider] = this.dependencies.vault.read(provider)
      if (job.mode === 'summarize') repairRecordingSpeakers(recording.id)
      const input: ProcessingInput = { id: recording.id, path: recording.file_path ?? '', checksum: recording.checksum ?? '', dataPath: this.dependencies.dataPath, settings, keys, profiles: job.mode === 'summarize' ? [] : voiceCandidates(), chatgptProfileId, summaryReady, recordedAt: recording.date_recorded, generation: job.generation ?? undefined, expectedSpeakers: queryOne<{ expected_speakers: number | null }>('SELECT expected_speakers FROM recording_overviews WHERE recording_id=?', [recording.id])?.expected_speakers ?? undefined, savedTranscript: job.mode === 'summarize' ? savedTranscript(recording.id) : undefined, referenceContext: reference }
      const result = await this.dependencies.runner.run(input, {
        stage: (stage, progress, message) => {
          if (this.stopped || this.paused.has(recording.id) || this.running.get(recording.id) !== task) return
          runInTransaction(() => { run('UPDATE transcription_jobs SET stage=?, progress=?, message=? WHERE recording_id=?', [stage, Math.max(0, Math.min(1, progress)), message, recording.id]); run('UPDATE recordings SET status=? WHERE id=?', [stage, recording.id]) })
          this.dependencies.changed()
        },
        checkpoint: value => { if (job.mode !== 'summarize' && !reviewTranscript && !this.stopped && !this.paused.has(recording.id) && this.running.get(recording.id) === task) { saveTranscript(recording.id, value, settings); this.dependencies.changed() } }
      })
      if (task.sessionCancelled) throw new ProcessingError('The ChatGPT connection changed. Processing will resume with the selected connection.')
      if (!this.stopped && !this.paused.has(recording.id)) {
        if (reviewTranscript) {
          runInTransaction(() => {
            if (!result.empty) stageTranscriptCandidate(recording.id, result, settings)
            run("UPDATE recordings SET status='done' WHERE id=?", [recording.id])
            run("UPDATE transcription_jobs SET stage='done',progress=1,summary_pending=0,error=NULL,message=? WHERE recording_id=?", [result.empty ? 'No usable speech was returned. Your corrected transcript was kept.' : 'New transcription ready for comparison. Your corrections and notes were kept.', recording.id])
          })
          this.dependencies.activity('info', result.empty ? 'Your corrected transcript was kept because the new transcription contained no usable speech.' : 'New transcription is ready for review. Apply it to regenerate the summary.')
          return
        }
        saveProcessingResult(recording.id, result, settings)
        if (!result.empty && !result.summary && job.mode !== 'summarize' && this.state().summaryReady) {
          // Release the transcription process before a separately limited summary job starts.
          this.enqueue(recording.id, true)
          this.dependencies.activity('success', 'Transcript is ready. The summary is queued separately.')
          return
        }
        this.dependencies.activity(result.empty ? 'info' : 'success', result.empty ? 'Skipped an empty recording after local audio checks.' : result.summary ? 'Transcript, summary and action items are ready.' : 'Local transcript is ready. Configure a summary provider to add a summary and action items.')
      }
    } catch (error) {
      if (!this.stopped && !this.paused.has(recording.id)) {
        const safe = safeProcessingError(error)
        if (task.sessionCancelled) {
          runInTransaction(() => { run("UPDATE transcription_jobs SET stage='queued', attempt=MAX(0,attempt-1), error=NULL, next_attempt_at=NULL, message='Waiting for the selected ChatGPT connection…' WHERE recording_id=?", [recording.id]); run("UPDATE recordings SET status='queued' WHERE id=?", [recording.id]) })
          return
        }
        if (error instanceof ChatGPTPlanBlocked && chatgptProfileId) {
          this.dependencies.chatgpt?.block?.(chatgptProfileId, safe.message)
          runInTransaction(() => { run("UPDATE transcription_jobs SET stage='queued', attempt=MAX(0,attempt-1), error=?, next_attempt_at=NULL, message='ChatGPT plan requests are paused. Review Manage usage in Settings.' WHERE recording_id=?", [safe.message, recording.id]); run("UPDATE recordings SET status='queued' WHERE id=?", [recording.id]) })
          this.dependencies.activity('warning', safe.message)
          return
        }
        const retry = safe.retryable && job.attempt + 1 < 4
        const next = retry ? new Date(this.now().getTime() + [10000, 60000, 300000][Math.min(job.attempt, 2)]).toISOString() : null
        runInTransaction(() => { run('UPDATE transcription_jobs SET stage=?, error=?, next_attempt_at=?, message=? WHERE recording_id=?', [retry ? 'queued' : 'failed', safe.message, next, retry ? 'Waiting before retry…' : 'Processing stopped. Retry when the issue is resolved.', recording.id]); run('UPDATE recordings SET status=? WHERE id=?', [retry ? 'queued' : 'failed', recording.id]) })
        this.dependencies.activity(retry ? 'warning' : 'error', safe.message)
      }
    }
  }
}
