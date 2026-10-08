import { randomUUID } from 'node:crypto'
import type { AISettings, AIState, ChatGPTState, TranscriptionQueueView } from '../../../src/shared/ai'
import { queryAll, queryOne, run, runInTransaction, type Recording } from '../services/database'
import type { CredentialVault } from './credentials'
import type { BackendObserver, ProcessingInput, ProcessingResult } from './backend'
import { ProcessingError, safeProcessingError } from './errors'
import { voiceCandidates } from './voices'
import { saveProcessingResult, saveTranscript } from './processing-store'
import { ChatGPTPlanBlocked } from './chatgpt-protocol'

export interface ProcessingRunner { run(input: ProcessingInput, observer: BackendObserver): Promise<ProcessingResult>; stop(): Promise<void> }
interface QueueDependencies { vault: CredentialVault; settings(): AISettings; dataPath: string; runner: ProcessingRunner; changed(): void; activity(type: 'info' | 'success' | 'warning' | 'error', message: string): void; now?: () => Date; chatgpt?: { state(): ChatGPTState; block?(id: string, message: string): void } }
interface Job { recording_id: string; attempt: number; next_attempt_at: string | null }

export class TranscriptionQueue {
  private active = false
  private stopped = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly now: () => Date
  private activeChatGPTProfile: string | undefined
  private sessionCancelled = false
  private startedAt: string | null = null
  constructor(private readonly dependencies: QueueDependencies) { this.now = dependencies.now ?? (() => new Date()) }
  state(): AIState {
    const settings = this.dependencies.settings()
    const providers = (['gemini', 'openai'] as const).map(p => this.dependencies.vault.state(p))
    const chatgpt = this.dependencies.chatgpt?.state()
    const transcriptionMissing = settings.transcription.provider !== 'local' && !providers.find(item => item.provider === settings.transcription.provider)?.verified
    const subscriptionMissing = settings.chat.provider === 'chatgpt' && !chatgpt?.planEnabled
    const summaryReason = subscriptionMissing ? 'Continue with ChatGPT in Settings and authorize plan usage for summaries.' : settings.chat.provider === 'chatgpt' && chatgpt?.usageBlocked ? chatgpt.error ?? 'ChatGPT plan requests are paused. Open Manage usage in Settings.' : settings.chat.provider !== 'chatgpt' && !providers.find(item => item.provider === settings.chat.provider)?.verified ? `Verify ${settings.chat.provider === 'gemini' ? 'Gemini' : 'OpenAI'} in Settings for summaries and action items.` : null
    const reason = transcriptionMissing ? `Verify ${settings.transcription.provider === 'gemini' ? 'Gemini' : 'OpenAI'} in Settings to start transcription.` : settings.transcription.provider === 'local' ? null : summaryReason
    return { settings, providers, ready: !reason, reason, chatgpt, summaryReady: !summaryReason, summaryReason, queue: this.queueView() }
  }
  private queueView(): TranscriptionQueueView {
    const active = queryOne<NonNullable<TranscriptionQueueView['active']>>("SELECT r.id, COALESCE(r.title,r.filename) AS title, j.stage, j.progress, j.message FROM transcription_jobs j JOIN recordings r ON r.id=j.recording_id WHERE j.stage NOT IN ('queued','done','empty','failed') ORDER BY j.created_at LIMIT 1")
    return { waiting: queryOne<{ count: number }>("SELECT count(*) AS count FROM transcription_jobs WHERE stage='queued'")?.count ?? 0, active: active ? { ...active, startedAt: this.startedAt } : null }
  }
  start(): void {
    runInTransaction(() => {
      run("UPDATE transcription_jobs SET stage='queued', progress=0, message='Resuming after restart…', attempt=MAX(0,attempt-1) WHERE stage NOT IN ('queued','done','empty','failed')")
      run("UPDATE recordings SET status='queued' WHERE id IN (SELECT recording_id FROM transcription_jobs WHERE stage='queued')")
    })
    this.enqueuePending()
    this.kick()
  }
  enqueue(id: string, manual = false): void {
    const recording = queryOne<Recording>('SELECT * FROM recordings WHERE id=?', [id])
    if (!recording?.verified || !recording.file_path || !recording.checksum) { if (manual) throw new Error('Download and verify the local audio before processing it.'); return }
    if (!manual && !this.dependencies.settings().autoTranscribe) return
    const existing = queryOne<{ stage: string; summary_pending: number }>('SELECT stage, summary_pending FROM transcription_jobs WHERE recording_id=?', [id])
    const addSummary = existing?.stage === 'done' && !!existing.summary_pending && this.state().summaryReady
    if (existing && !['failed', 'empty'].includes(existing.stage) && !addSummary) return
    runInTransaction(() => {
      run("INSERT INTO transcription_jobs(id, recording_id, stage, created_at) VALUES (?, ?, 'queued', ?) ON CONFLICT(recording_id) DO UPDATE SET stage='queued', attempt=0, next_attempt_at=NULL, progress=0, error=NULL, message='Waiting to process…'", [randomUUID(), id, this.now().toISOString()])
      run("UPDATE recordings SET status='queued' WHERE id=?", [id])
    })
    this.dependencies.changed()
    this.kick()
  }
  enqueuePending(manual = false): number {
    if (!manual && !this.dependencies.settings().autoTranscribe) return 0
    const rows = queryAll<{ id: string }>("SELECT r.id FROM recordings r LEFT JOIN transcription_jobs j ON j.recording_id=r.id WHERE r.verified=1 AND r.file_path IS NOT NULL AND r.checksum IS NOT NULL AND (j.id IS NULL OR (j.stage='done' AND j.summary_pending=1 AND ?=1)) ORDER BY r.date_recorded", [Number(this.state().summaryReady)])
    for (const row of rows) this.enqueue(row.id, manual)
    return rows.length
  }
  kick(): void {
    if (this.stopped || this.active) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => { this.timer = null; void this.tick().catch(() => this.dependencies.activity('error', 'The processing queue could not start. Check Settings and retry.')) }, 0)
  }
  async stop(): Promise<void> {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    await this.dependencies.runner.stop()
  }
  invalidateChatGPTSession(profileId: string): void {
    if (!this.active || this.activeChatGPTProfile !== profileId) return
    this.sessionCancelled = true
    void this.dependencies.runner.stop().catch(() => this.dependencies.activity('warning', 'The old ChatGPT processing session could not close immediately.'))
  }
  private async tick(): Promise<void> {
    if (this.stopped || this.active || !this.state().ready) return
    const job = queryOne<Job>("SELECT recording_id, attempt, next_attempt_at FROM transcription_jobs WHERE stage='queued' ORDER BY COALESCE(next_attempt_at,created_at), created_at LIMIT 1")
    if (!job) return
    const wait = job.next_attempt_at ? Date.parse(job.next_attempt_at) - this.now().getTime() : 0
    if (wait > 0) { this.timer = setTimeout(() => { this.timer = null; this.kick() }, Math.min(wait, 2147483647)); return }
    const recording = queryOne<Recording>('SELECT * FROM recordings WHERE id=?', [job.recording_id])
    if (!recording?.file_path || !recording.checksum || !recording.verified) {
      run("UPDATE transcription_jobs SET stage='failed', error='The verified local audio is unavailable.' WHERE recording_id=?", [job.recording_id])
      run("UPDATE recordings SET status='failed' WHERE id=?", [job.recording_id]); this.dependencies.changed(); this.kick(); return
    }
    this.active = true
    this.startedAt = this.now().toISOString()
    let chatgptProfileId: string | undefined
    this.sessionCancelled = false
    try {
      runInTransaction(() => { run("UPDATE transcription_jobs SET stage='converting', progress=0, attempt=attempt+1, error=NULL, next_attempt_at=NULL, message='Starting the background processor…' WHERE recording_id=?", [job.recording_id]); run("UPDATE recordings SET status='converting' WHERE id=?", [job.recording_id]) })
      this.dependencies.changed()
      const settings = this.dependencies.settings()
      const summaryReady = this.state().summaryReady ?? true
      chatgptProfileId = summaryReady && settings.chat.provider === 'chatgpt' ? this.dependencies.chatgpt?.state().activeProfileId ?? undefined : undefined
      this.activeChatGPTProfile = chatgptProfileId
      const keys: ProcessingInput['keys'] = { gemini: null, openai: null }
      for (const provider of new Set([...(settings.transcription.provider === 'local' ? [] : [settings.transcription.provider]), ...(!summaryReady || settings.chat.provider === 'chatgpt' ? [] : [settings.chat.provider])])) keys[provider] = this.dependencies.vault.read(provider)
      const input: ProcessingInput = { id: recording.id, path: recording.file_path, checksum: recording.checksum, dataPath: this.dependencies.dataPath, settings, keys, profiles: voiceCandidates(), chatgptProfileId, summaryReady }
      const result = await this.dependencies.runner.run(input, {
        stage: (stage, progress, message) => {
          if (this.stopped) return
          runInTransaction(() => { run('UPDATE transcription_jobs SET stage=?, progress=?, message=? WHERE recording_id=?', [stage, Math.max(0, Math.min(1, progress)), message, recording.id]); run('UPDATE recordings SET status=? WHERE id=?', [stage, recording.id]) })
          this.dependencies.changed()
        },
        checkpoint: value => { if (!this.stopped) { saveTranscript(recording.id, value, settings); this.dependencies.changed() } }
      })
      if (this.sessionCancelled) throw new ProcessingError('The ChatGPT connection changed. Processing will resume with the selected connection.')
      if (!this.stopped) {
        saveProcessingResult(recording.id, result, settings)
        this.dependencies.activity(result.empty ? 'info' : 'success', result.empty ? 'Skipped an empty recording after local audio checks.' : result.summary ? 'Transcript, summary and action items are ready.' : 'Local transcript is ready. Configure a summary provider to add a summary and action items.')
      }
    } catch (error) {
      if (!this.stopped) {
        const safe = safeProcessingError(error)
        if (this.sessionCancelled) {
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
    } finally {
      this.active = false
      this.startedAt = null
      this.activeChatGPTProfile = undefined
      if (!this.stopped) { this.dependencies.changed(); this.kick() }
    }
  }
}
