import { fork, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { EmbeddingRunner } from './semantic-index'

/** Keeps model loading and CPU inference out of the renderer and main process. */
export class UtilityEmbeddingRunner implements EmbeddingRunner {
  private worker: ChildProcess | null = null
  private spawning: Promise<void> | null = null
  private readonly pending = new Map<string, { resolve(vectors: number[][]): void; reject(error: Error): void; cleanup(): void }>()
  private idle: ReturnType<typeof setTimeout> | undefined
  constructor(private readonly modelDirectory: string) {}
  async embed(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    signal?.throwIfAborted()
    clearTimeout(this.idle)
    if (!this.worker) {
      const worker = fork(join(process.env.WORKER_DIR ?? __dirname, 'embedding-worker.cjs'), [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } })
      this.worker = worker
      this.spawning = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { reject(new Error('The local search worker did not start.')); worker.kill() }, 30000)
        worker.once('spawn', () => { clearTimeout(timer); worker.send({ type: 'initialize', directory: this.modelDirectory }); resolve() })
        worker.once('exit', () => { clearTimeout(timer); reject(new Error('The local search worker stopped before starting.')) })
      })
      worker.on('message', (message: { id: string; vectors?: number[][]; error?: string }) => {
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id); pending.cleanup()
        if (message.error || !message.vectors) pending.reject(new Error(message.error ?? 'The search model returned no result.'))
        else pending.resolve(message.vectors)
        if (!this.pending.size) this.idle = setTimeout(() => { void this.stop() }, 60000)
      })
      worker.on('error', () => worker.emit('exit', 1, null))
      worker.on('exit', () => { if (this.worker === worker) { this.worker = null; this.fail(new Error('The local search worker stopped. Retry search setup.')) } })
    }
    await this.spawning
    signal?.throwIfAborted()
    if (!this.worker) throw new Error('Local search was stopped.')
    const worker = this.worker, id = randomUUID()
    return new Promise((resolve, reject) => {
      const abort = (): void => { const pending = this.pending.get(id); if (pending) { this.pending.delete(id); pending.cleanup(); reject(new Error('Local search was cancelled.')) } }
      const timer = setTimeout(() => { this.fail(new Error('The local search model timed out. Try again.')); worker.kill(); if (this.worker === worker) this.worker = null }, 120000)
      this.pending.set(id, { resolve, reject, cleanup: () => { clearTimeout(timer); signal?.removeEventListener('abort', abort) } })
      signal?.addEventListener('abort', abort, { once: true })
      worker.send({ type: 'embed', id, texts })
    })
  }
  async stop(): Promise<void> { clearTimeout(this.idle); const worker = this.worker; this.worker = null; this.fail(new Error('Local search was stopped.')); worker?.kill() }
  private fail(error: Error): void { for (const request of this.pending.values()) { request.cleanup(); request.reject(error) }; this.pending.clear() }
}
