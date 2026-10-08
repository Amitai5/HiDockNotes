import { LocalTranscriptionBackend, type ProcessingInput } from './ai/backend'
import { providerFactory } from './ai/provider-factory'
import { ProcessingError, safeProcessingError } from './ai/errors'
import type { WorkerMessage } from './ai/worker-runner'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { ChatGPTPlanBlocked } from './ai/chatgpt-protocol'

const cancellation = new AbortController()
let started = false
process.parentPort.postMessage({ type: 'ready' })
const tokenRequests = new Map<string, { resolve(value: string): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
function send(value: WorkerMessage): void { process.parentPort.postMessage(value) }
function chatgptToken(): Promise<string> {
  cancellation.signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const requestId = randomUUID()
    const timer = setTimeout(() => { tokenRequests.delete(requestId); reject(new ProcessingError('ChatGPT session renewal timed out. Reconnect in Settings.', true)) }, 90000)
    tokenRequests.set(requestId, { resolve, reject, timer })
    send({ type: 'chatgpt-token', requestId })
  })
}
process.parentPort.on('message', (event: { data: { type: 'start'; input: ProcessingInput } | { type: 'cancel' } | { type: 'chatgpt-token-result'; requestId: string; token?: string; error?: string; blocked?: boolean } }) => {
  if (event.data.type === 'chatgpt-token-result') {
    const pending = tokenRequests.get(event.data.requestId)
    if (pending) { clearTimeout(pending.timer); tokenRequests.delete(event.data.requestId); if (event.data.token) pending.resolve(event.data.token); else pending.reject(event.data.blocked ? new ChatGPTPlanBlocked(event.data.error ?? 'ChatGPT plan requests are paused.') : new ProcessingError(event.data.error ?? 'ChatGPT session renewal failed.')) }
    return
  }
  if (event.data.type === 'cancel') { cancellation.abort(); for (const pending of tokenRequests.values()) { clearTimeout(pending.timer); pending.reject(new ProcessingError('Processing was cancelled.')) }; tokenRequests.clear(); return }
  if (started) return
  started = true
  const input = event.data.input
  const backend = new LocalTranscriptionBackend(providerFactory(chatgptToken, undefined, undefined, join(input.dataPath, 'models', 'whisper-v1')))
  void backend.process(input, {
    stage: (stage, progress, message) => send({ type: 'stage', stage, progress, message }),
    checkpoint: value => send({ type: 'checkpoint', value })
  }, cancellation.signal).then(value => send({ type: 'result', value })).catch(error => {
    const safe = safeProcessingError(error)
    send({ type: 'error', message: safe.message, retryable: safe.retryable, chatgptBlocked: error instanceof ChatGPTPlanBlocked })
  }).finally(() => { input.keys.gemini = null; input.keys.openai = null })
})
