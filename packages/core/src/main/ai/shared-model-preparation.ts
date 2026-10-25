import { join } from 'node:path'
import { ModelCache, type DiarizationModels } from './model-cache'
import { WhisperModelCache, type WhisperModelFiles } from './whisper-model-cache'

export type ModelKind = 'speech' | 'speakers' | 'whisper-base' | 'whisper-small'
export type PreparedModel = string | DiarizationModels | WhisperModelFiles
type Progress = (message: string, fraction?: number) => void
type Load = (dataPath: string, kind: ModelKind, progress: Progress, signal: AbortSignal) => Promise<PreparedModel>
interface Preparation { controller: AbortController; listeners: Set<Progress>; complete: boolean; promise: Promise<PreparedModel> }

async function loadModels(dataPath: string, kind: ModelKind, progress: Progress, signal: AbortSignal): Promise<PreparedModel> {
  if (kind === 'speech') return new ModelCache(join(dataPath, 'models', 'speech-v1')).ensureSpeech(progress, signal)
  if (kind === 'speakers') return new ModelCache(join(dataPath, 'models', 'speaker-v1')).ensure(progress, signal)
  return new WhisperModelCache(join(dataPath, 'models', 'whisper-v1')).ensure(kind, progress, signal)
}

/** The server coordinates downloads so concurrent workers share verified model preparation. */
export class SharedModelPreparation {
  private readonly pending = new Map<string, Preparation>()
  constructor(private readonly load: Load = loadModels) {}
  prepare(dataPath: string, kind: ModelKind, progress: Progress, signal: AbortSignal): Promise<PreparedModel> {
    signal.throwIfAborted()
    const key = JSON.stringify([dataPath, kind])
    let task = this.pending.get(key)
    if (!task || task.controller.signal.aborted) {
      const created: Preparation = { controller: new AbortController(), listeners: new Set(), complete: false, promise: Promise.resolve('') }
      task = created; this.pending.set(key, created)
      created.promise = Promise.resolve().then(() => this.load(dataPath, kind, (message, fraction) => {
        for (const listener of created.listeners) listener(message, fraction)
      }, created.controller.signal)).finally(() => { created.complete = true; if (this.pending.get(key) === created) this.pending.delete(key) })
    }
    const shared = task
    return new Promise((resolve, reject) => {
      const listener: Progress = (message, fraction) => progress(message, fraction)
      const cleanup = () => {
        signal.removeEventListener('abort', abort); shared.listeners.delete(listener)
        if (!shared.complete && !shared.listeners.size) shared.controller.abort()
      }
      const abort = () => { cleanup(); reject(signal.reason) }
      shared.listeners.add(listener); signal.addEventListener('abort', abort, { once: true })
      shared.promise.then(value => { cleanup(); resolve(value) }, error => { cleanup(); reject(error) })
      if (signal.aborted) abort()
    })
  }
  async drain(): Promise<void> { await Promise.all([...this.pending.values()].map(task => task.promise.catch(() => undefined))) }
}
