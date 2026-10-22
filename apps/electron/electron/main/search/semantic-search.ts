import { rm } from 'node:fs/promises'
import type { RecordingCitation } from '../../../src/shared/ai'
import type { RecordingView } from '../../../src/shared/contracts'
import { EMPTY_SEMANTIC_STATE, type SearchMode, type SemanticSearchState } from '../../../src/shared/semantic-search'
import { listRecordings, queryAll, queryOne, run } from '../services/database'
import { downloadSearchModel, hasSearchModel, searchModelDirectory, SEARCH_MODEL_ID } from './semantic-model'
import { saveSearchDocument, searchDocument, semanticCitations, semanticHits, type EmbeddingRunner } from './semantic-index'

interface Dependencies { dataPath: string; runner: EmbeddingRunner; changed(state: SemanticSearchState): void; now?: () => Date; request?: typeof fetch; modelAvailable?: () => Promise<boolean>; download?: (progress: (value: number) => void, signal: AbortSignal) => Promise<void> }
/** Optional local indexing. Starting the app or restoring a backup never downloads the model. */
export class SemanticSearch {
  private view: SemanticSearchState = { ...EMPTY_SEMANTIC_STATE }
  private task: Promise<void> | null = null
  private controller: AbortController | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private dirty = false
  private publishedAt = 0
  private readonly directory: string
  constructor(private readonly dependencies: Dependencies) { this.directory = searchModelDirectory(dependencies.dataPath) }
  async initialize(): Promise<void> {
    const enabled = queryOne<{ value: string }>("SELECT value FROM settings WHERE key='semantic-enabled'")?.value === 'true'
    const offered = queryOne<{ value: string }>("SELECT value FROM settings WHERE key='semantic-setup-offered'")?.value === 'true'
    const modelReady = await this.modelAvailable()
    this.publish({ enabled: enabled && modelReady, modelReady, setupOffered: offered, phase: enabled && modelReady ? 'ready' : 'idle' })
    if (enabled && modelReady) this.scheduleIndex()
  }
  state(): SemanticSearchState {
    return { ...this.view, indexedRecordings: queryOne<{ count: number }>('SELECT count(*) AS count FROM semantic_documents WHERE model=?', [SEARCH_MODEL_ID])!.count, totalRecordings: queryOne<{ count: number }>('SELECT count(*) AS count FROM recordings WHERE verified=1')!.count }
  }
  enable(): SemanticSearchState {
    if (this.task) return this.state()
    this.save('semantic-enabled', true); this.dismissSetup(); this.publish({ enabled: true, error: null })
    this.start(true); return this.state()
  }
  dismissSetup(): void { this.save('semantic-setup-offered', true); this.publish({ setupOffered: true }) }
  async disable(): Promise<SemanticSearchState> {
    this.save('semantic-enabled', false); clearTimeout(this.timer); this.view.enabled = false
    this.controller?.abort(); await this.task?.catch(() => undefined); await this.dependencies.runner.stop()
    this.publish({ enabled: false, phase: 'idle', error: null }); return this.state()
  }
  async removeModel(): Promise<SemanticSearchState> {
    await this.disable()
    // The path is a fixed application-owned child; no caller-supplied path reaches deletion.
    await rm(this.directory, { recursive: true, force: true })
    run('DELETE FROM semantic_documents'); run('DELETE FROM semantic_chunks')
    this.publish({ modelReady: false, progress: 0 }); return this.state()
  }
  scheduleIndex(): void {
    clearTimeout(this.timer)
    if (this.task) { this.dirty = true; return }
    if (this.view.enabled && this.view.modelReady && !this.task) this.timer = setTimeout(() => this.start(false), 1500)
  }
  async search(query: string, status = '', mode: SearchMode = 'keywords'): Promise<RecordingView[]> {
    const keywords = listRecordings(query, status)
    if (!query.trim() || mode === 'keywords') return keywords
    if (!this.view.enabled || !this.view.modelReady) throw new Error('Enable and download local meaning search in Settings first.')
    const [vector] = await this.dependencies.runner.embed([query])
    const hits = await semanticHits(vector)
    const all = new Map(listRecordings('', status).map(recording => [recording.id, recording]))
    const scores = new Map<string, number>(), excerpts = new Map(hits.map(hit => [hit.recordingId, hit]))
    keywords.forEach((recording, index) => scores.set(recording.id, 1 + 1 / (index + 1)))
    hits.forEach(hit => { if (all.has(hit.recordingId)) scores.set(hit.recordingId, (scores.get(hit.recordingId) ?? 0) + hit.score) })
    return [...scores].sort((a, b) => b[1] - a[1]).slice(0, 100).flatMap(([id]) => {
      const recording = all.get(id), hit = excerpts.get(id)
      return recording ? [{ ...recording, ...(hit ? { searchMatch: { kind: 'meaning' as const, excerpt: hit.text.slice(0, 450), start: hit.start } } : {}) }] : []
    })
  }
  async citations(query: string, projectId: string | null, signal?: AbortSignal): Promise<RecordingCitation[]> {
    if (!this.view.enabled || !this.view.modelReady || this.view.phase === 'failed') return []
    try {
      const [vector] = await this.dependencies.runner.embed([query.slice(0, 4000)], signal)
      return semanticCitations(await semanticHits(vector, projectId, true))
    } catch {
      signal?.throwIfAborted()
      this.publish({ phase: 'failed', error: 'Meaning search could not run. Assistant is using keyword search; retry local search setup in Settings.' })
      return []
    }
  }
  async stop(): Promise<void> { clearTimeout(this.timer); this.controller?.abort(); await this.task?.catch(() => undefined); await this.dependencies.runner.stop() }
  private start(download: boolean): void {
    if (this.task || !this.view.enabled) return
    const controller = new AbortController(); this.controller = controller
    const task = this.index(download, controller.signal)
    this.task = task
    void task.catch(error => { if (!controller.signal.aborted) this.publish({ phase: 'failed', error: error instanceof Error ? error.message : 'Local meaning search could not be prepared.' }) }).finally(() => { if (this.task === task) { this.task = null; this.controller = null }; if (this.dirty && !controller.signal.aborted && this.view.phase !== 'failed') { this.dirty = false; this.scheduleIndex() } })
  }
  private async index(allowDownload: boolean, signal: AbortSignal): Promise<void> {
    if (!this.view.modelReady) {
      if (!allowDownload) return
      this.publish({ phase: 'downloading', progress: 0 })
      const progress = (value: number): void => this.publish({ progress: value })
      if (this.dependencies.download) await this.dependencies.download(progress, signal)
      else await downloadSearchModel(this.directory, progress, signal, this.dependencies.request)
      this.publish({ modelReady: true })
    }
    const ids = queryAll<{ id: string }>('SELECT id FROM recordings WHERE verified=1 ORDER BY date_recorded DESC').map(row => row.id)
    this.publish({ phase: 'indexing', progress: 0 })
    for (let position = 0; position < ids.length; position++) {
      signal.throwIfAborted()
      if (queryOne("SELECT id FROM transcription_jobs WHERE stage IN ('converting','diarizing','transcribing','identifying') LIMIT 1")) { this.dirty = true; this.publish({ phase: 'waiting' }); return }
      const document = searchDocument(ids[position])
      const saved = queryOne<{ fingerprint: string; model: string }>('SELECT fingerprint,model FROM semantic_documents WHERE recording_id=?', [ids[position]])
      if (document && (saved?.fingerprint !== document.fingerprint || saved?.model !== SEARCH_MODEL_ID)) {
        const vectors: number[][] = []
        for (let offset = 0; offset < document.chunks.length; offset += 8) {
          if (queryOne("SELECT id FROM transcription_jobs WHERE stage IN ('converting','diarizing','transcribing','identifying') LIMIT 1")) { this.dirty = true; this.publish({ phase: 'waiting' }); return }
          vectors.push(...await this.dependencies.runner.embed(document.chunks.slice(offset, offset + 8).map(chunk => chunk.text), signal))
          signal.throwIfAborted(); this.publish({ progress: (position + Math.min(1, (offset + 8) / document.chunks.length)) / Math.max(1, ids.length) })
        }
        saveSearchDocument(document, vectors, (this.dependencies.now?.() ?? new Date()).toISOString())
      }
      this.publish({ progress: (position + 1) / Math.max(1, ids.length) })
      await new Promise<void>(resolve => setImmediate(resolve))
    }
    this.publish({ phase: 'ready', progress: 1, error: null })
  }
  private modelAvailable(): Promise<boolean> { return this.dependencies.modelAvailable?.() ?? hasSearchModel(this.directory) }
  private save(key: string, value: boolean): void { run('INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)', [key, JSON.stringify(value)]) }
  private publish(patch: Partial<SemanticSearchState>): void {
    const important = patch.phase !== undefined || patch.enabled !== undefined || patch.error !== undefined || patch.modelReady !== undefined || patch.setupOffered !== undefined
    this.view = { ...this.view, ...patch }
    if (important || Date.now() - this.publishedAt >= 250) { this.publishedAt = Date.now(); this.dependencies.changed(this.state()) }
  }
}
