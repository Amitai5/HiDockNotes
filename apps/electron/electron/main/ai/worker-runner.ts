import { utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'node:path'
import type { BackendObserver, ProcessingInput, ProcessingResult, TranscriptCheckpoint } from './backend'
import type { RecordingStatus } from '../../../src/shared/contracts'
import { ProcessingError } from './errors'
import { ChatGPTPlanBlocked } from './chatgpt-protocol'

export type WorkerMessage = { type: 'ready' } | { type: 'stage'; stage: RecordingStatus; progress: number; message: string } | { type: 'checkpoint'; value: TranscriptCheckpoint } | { type: 'result'; value: ProcessingResult } | { type: 'error'; message: string; retryable: boolean; chatgptBlocked?: boolean } | { type: 'chatgpt-token'; requestId: string }
export class UtilityProcessingRunner {
  private worker: UtilityProcess | null = null
  private running: Promise<ProcessingResult> | null = null
  constructor(private readonly chatgptToken?: (profileId: string) => Promise<string>) {}
  async run(input: ProcessingInput, observer: BackendObserver): Promise<ProcessingResult> {
    if (this.worker) throw new Error('A transcription worker is already running.')
    const worker = utilityProcess.fork(join(__dirname, 'transcription-worker.js'), [], { serviceName: 'Recording processing', stdio: 'ignore' })
    this.worker = worker
    this.running = new Promise<ProcessingResult>((resolve, reject) => {
      let finished = false
      // A failed worker handshake must become a retryable error, rather than
      // occupy the queue forever while every other recording waits.
      const startupTimer = setTimeout(() => { if (!finished) { finished = true; reject(new ProcessingError('The background processor did not start. Retrying the recording.', true)) } }, 30000)
      const settle = (): void => { clearTimeout(startupTimer); finished = true }
      worker.on('spawn', () => { if (!finished) worker.postMessage({ type: 'start', input }) })
      worker.on('message', (value: WorkerMessage) => {
        if (finished) return
        try {
          if (value.type === 'ready') clearTimeout(startupTimer)
          else if (value.type === 'chatgpt-token') {
            if (!input.chatgptProfileId || !this.chatgptToken) { worker.postMessage({ type: 'chatgpt-token-result', requestId: value.requestId, error: 'Connect your ChatGPT account in Settings.' }); return }
            void this.chatgptToken(input.chatgptProfileId).then(token => { if (!finished && this.worker === worker) worker.postMessage({ type: 'chatgpt-token-result', requestId: value.requestId, token }) }).catch(error => { if (!finished && this.worker === worker) worker.postMessage({ type: 'chatgpt-token-result', requestId: value.requestId, error: error instanceof ProcessingError ? error.message : 'Your ChatGPT session could not be refreshed. Reconnect in Settings.', blocked: error instanceof ChatGPTPlanBlocked }) })
          }
          else if (value.type === 'stage') { clearTimeout(startupTimer); observer.stage(value.stage, value.progress, value.message) }
          else if (value.type === 'checkpoint') observer.checkpoint(value.value)
          else if (value.type === 'result') { settle(); resolve(value.value) }
          else if (value.type === 'error') { settle(); reject(value.chatgptBlocked ? new ChatGPTPlanBlocked(value.message) : new ProcessingError(value.message, value.retryable)) }
        } catch { settle(); reject(new ProcessingError('The processing result could not be saved. Check disk space and retry.')) }
      })
      worker.on('exit', () => { clearTimeout(startupTimer); if (!finished) { finished = true; reject(new ProcessingError('The background worker stopped unexpectedly. Retry the recording.', true)) } })
    })
    try { return await this.running } finally { this.worker = null; this.running = null; worker.kill() }
  }
  async stop(): Promise<void> {
    const worker = this.worker, running = this.running
    if (!worker) return
    worker.postMessage({ type: 'cancel' })
    const timer = setTimeout(() => worker.kill(), 3000)
    // This worker owns CPU/audio/AI work only. USB remains in the main process,
    // where the device's drain and graceful-close paths run independently.
    try { await running?.catch(() => undefined) } finally { clearTimeout(timer) }
  }
}
