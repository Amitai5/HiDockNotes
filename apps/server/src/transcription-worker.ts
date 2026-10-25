const sendToParent = (message: unknown): void => { process.send?.(message) }
import { LocalTranscriptionBackend, type ProcessingInput } from '@hidock/core/ai/backend'
import { providerFactory } from '@hidock/core/ai/provider-factory'
import { ProcessingError, safeProcessingError } from '@hidock/core/ai/errors'
import type { WorkerMessage } from '@hidock/core/ai/worker-runner'
import type { ModelKind, PreparedModel } from '@hidock/core/ai/shared-model-preparation'
import type { DiarizationModels } from '@hidock/core/ai/model-cache'
import type { WhisperModelFiles } from '@hidock/core/ai/whisper-model-cache'
import { randomUUID } from 'node:crypto'
import { ChatGPTPlanBlocked } from '@hidock/core/ai/chatgpt-protocol'

const cancellation = new AbortController()
let started = false
const tokenRequests = new Map<string, { resolve(value: string): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
const modelRequests = new Map<string, { resolve(value: PreparedModel): void; reject(error: Error): void; progress(message: string, fraction?: number): void; timer: ReturnType<typeof setTimeout> }>()
function send(value: WorkerMessage): void { sendToParent(value) }
function chatgptToken(): Promise<string> {
  cancellation.signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const requestId = randomUUID()
    const timer = setTimeout(() => { tokenRequests.delete(requestId); reject(new ProcessingError('ChatGPT session renewal timed out. Reconnect in Settings.', true)) }, 90000)
    tokenRequests.set(requestId, { resolve, reject, timer }); send({ type: 'chatgpt-token', requestId })
  })
}
function models(kind: ModelKind, progress: (message: string, fraction?: number) => void): Promise<PreparedModel> {
  cancellation.signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const requestId = randomUUID()
    const timer = setTimeout(() => { modelRequests.delete(requestId); reject(new ProcessingError('Server model preparation timed out. Retry the recording.', true)) }, 2100000)
    modelRequests.set(requestId, { resolve, reject, progress, timer }); send({ type: 'models', requestId, kind })
  })
}
type ParentMessage = { type: 'start'; input: ProcessingInput } | { type: 'cancel' } | { type: 'chatgpt-token-result'; requestId: string; token?: string; error?: string; blocked?: boolean } | { type: 'models-result'; requestId: string; value?: PreparedModel; error?: string; retryable?: boolean } | { type: 'models-progress'; requestId: string; message: string; fraction?: number }
process.on('message', (data: ParentMessage) => {
  if (data.type === 'models-progress') { modelRequests.get(data.requestId)?.progress(data.message, data.fraction); return }
  if (data.type === 'models-result') {
    const pending = modelRequests.get(data.requestId)
    if (pending) { clearTimeout(pending.timer); modelRequests.delete(data.requestId); if (data.value) pending.resolve(data.value); else pending.reject(new ProcessingError(data.error ?? 'Server model preparation failed.', data.retryable)) }
    return
  }
  if (data.type === 'chatgpt-token-result') {
    const pending = tokenRequests.get(data.requestId)
    if (pending) { clearTimeout(pending.timer); tokenRequests.delete(data.requestId); if (data.token) pending.resolve(data.token); else pending.reject(data.blocked ? new ChatGPTPlanBlocked(data.error ?? 'ChatGPT plan requests are paused.') : new ProcessingError(data.error ?? 'ChatGPT session renewal failed.')) }
    return
  }
  if (data.type === 'cancel') {
    cancellation.abort()
    for (const pending of [...tokenRequests.values(), ...modelRequests.values()]) { clearTimeout(pending.timer); pending.reject(new ProcessingError('Processing was cancelled.')) }
    tokenRequests.clear(); modelRequests.clear(); return
  }
  if (started) return
  started = true
  const input = data.input
  const providers = providerFactory(chatgptToken, undefined, undefined, undefined, { ensure: async (kind, progress) => await models(kind, progress) as WhisperModelFiles })
  const backend = new LocalTranscriptionBackend(providers, undefined, () => ({ ensureSpeech: async progress => await models('speech', progress) as string, ensure: async progress => await models('speakers', (message, fraction) => progress(message, fraction ?? 0)) as DiarizationModels }))
  void backend.process(input, {
    stage: (stage, progress, message) => send({ type: 'stage', stage, progress, message }), checkpoint: value => send({ type: 'checkpoint', value })
  }, cancellation.signal).then(value => send({ type: 'result', value })).catch(error => {
    const safe = safeProcessingError(error); send({ type: 'error', message: safe.message, retryable: safe.retryable, chatgptBlocked: error instanceof ChatGPTPlanBlocked })
  }).finally(() => { input.keys.gemini = null; input.keys.openai = null })
})
send({ type: 'ready' })
