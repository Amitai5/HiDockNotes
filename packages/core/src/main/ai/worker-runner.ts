import { fork, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import type { BackendObserver, ProcessingInput, ProcessingResult, TranscriptCheckpoint } from './backend'
import type { RecordingStatus } from '../../../src/shared/contracts'
import { ProcessingError, safeProcessingError } from './errors'
import { ChatGPTPlanBlocked } from './chatgpt-protocol'
import { SharedModelPreparation, type ModelKind } from './shared-model-preparation'

export type WorkerMessage = { type: 'ready' } | { type: 'stage'; stage: RecordingStatus; progress: number; message: string } | { type: 'checkpoint'; value: TranscriptCheckpoint } | { type: 'result'; value: ProcessingResult } | { type: 'error'; message: string; retryable: boolean; chatgptBlocked?: boolean } | { type: 'chatgpt-token'; requestId: string } | { type: 'models'; requestId: string; kind: ModelKind }
interface RunningWorker { worker: ChildProcess; running: Promise<ProcessingResult> | null; models: AbortController }
export class UtilityProcessingRunner {
  private readonly workers = new Map<string, RunningWorker>()
  constructor(private readonly chatgptToken?: (profileId: string) => Promise<string>, private readonly models = new SharedModelPreparation()) {}
  async run(input: ProcessingInput, observer: BackendObserver): Promise<ProcessingResult> {
    if (this.workers.has(input.id)) throw new Error('This recording already has a processing worker.')
    const worker = fork(join(process.env.WORKER_DIR ?? __dirname, 'transcription-worker.cjs'), [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } })
    const entry: RunningWorker = { worker, running: null, models: new AbortController() }
    this.workers.set(input.id, entry)
    entry.running = new Promise<ProcessingResult>((resolve, reject) => {
      let finished = false
      const current = () => !finished && this.workers.get(input.id) === entry && worker.connected
      const send = (value: object) => { if (current()) worker.send(value) }
      const startupTimer = setTimeout(() => { if (!finished) { finished = true; reject(new ProcessingError('The background processor did not start. Retrying the recording.', true)) } }, 30000)
      const settle = (): void => { clearTimeout(startupTimer); finished = true }
      worker.on('spawn', () => send({ type: 'start', input }))
      worker.on('message', (value: WorkerMessage) => {
        if (!current()) return
        try {
          if (value.type === 'ready') clearTimeout(startupTimer)
          else if (value.type === 'models') {
            if (!['speech', 'speakers', 'whisper-base', 'whisper-small'].includes(value.kind)) { send({ type: 'models-result', requestId: value.requestId, error: 'Choose a supported server model.' }); return }
            void this.models.prepare(input.dataPath, value.kind, (message, fraction) => send({ type: 'models-progress', requestId: value.requestId, message, fraction }), entry.models.signal).then(result => send({ type: 'models-result', requestId: value.requestId, value: result })).catch(error => { const safe = safeProcessingError(error); send({ type: 'models-result', requestId: value.requestId, error: safe.message, retryable: safe.retryable }) })
          }
          else if (value.type === 'chatgpt-token') {
            if (!input.chatgptProfileId || !this.chatgptToken) { send({ type: 'chatgpt-token-result', requestId: value.requestId, error: 'Connect your ChatGPT account in Settings.' }); return }
            void this.chatgptToken(input.chatgptProfileId).then(token => send({ type: 'chatgpt-token-result', requestId: value.requestId, token })).catch(error => send({ type: 'chatgpt-token-result', requestId: value.requestId, error: error instanceof ProcessingError ? error.message : 'Your ChatGPT session could not be refreshed. Reconnect in Settings.', blocked: error instanceof ChatGPTPlanBlocked }))
          }
          else if (value.type === 'stage') { clearTimeout(startupTimer); observer.stage(value.stage, value.progress, value.message) }
          else if (value.type === 'checkpoint') observer.checkpoint(value.value)
          else if (value.type === 'result') { settle(); resolve(value.value) }
          else if (value.type === 'error') { settle(); reject(value.chatgptBlocked ? new ChatGPTPlanBlocked(value.message) : new ProcessingError(value.message, value.retryable)) }
        } catch { settle(); reject(new ProcessingError('The processing result could not be saved. Check disk space and retry.')) }
      })
      worker.on('error', () => worker.emit('exit', 1, null))
      worker.on('exit', () => { clearTimeout(startupTimer); if (!finished) { finished = true; reject(new ProcessingError('The background worker stopped unexpectedly. Retry the recording.', true)) } })
    })
    try { return await entry.running } finally { entry.models.abort(); if (this.workers.get(input.id) === entry) this.workers.delete(input.id); worker.kill() }
  }
  async stop(recordingId?: string): Promise<void> {
    const selected = recordingId === undefined ? [...this.workers.values()] : [this.workers.get(recordingId)].filter((worker): worker is RunningWorker => !!worker)
    await Promise.all(selected.map(async entry => {
      entry.models.abort()
      if (entry.worker.connected) entry.worker.send({ type: 'cancel' })
      const timer = setTimeout(() => entry.worker.kill(), 3000)
      try { await entry.running?.catch(() => undefined) } finally { clearTimeout(timer) }
    }))
    if (recordingId === undefined) await this.models.drain()
  }
}
