import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, createProject, initializeDatabase, queryAll, queryOne, run, upsertRecordingFromDevice } from '../services/database'
import { searchDocument, saveSearchDocument, semanticHits, semanticCitations, vectorBytes, type EmbeddingRunner } from '../search/semantic-index'
import { SemanticSearch } from '../search/semantic-search'
import { SEARCH_MODEL_ID } from '../search/semantic-model'

const date = '2026-10-21T10:00:00.000Z'
const vector = (axis: number): number[] => Array.from({ length: 384 }, (_, index) => Number(index === axis))
let services: SemanticSearch[] = []
beforeEach(() => { initializeDatabase(':memory:'); services = [] })
afterEach(async () => { await Promise.all(services.map(service => service.stop())); closeDatabase() })
function recording(filename: string, words: string, project: string | null = null): string {
  const id = upsertRecordingFromDevice({ filename, size: 1, duration: 20, dateCreated: new Date(date) }).id
  run('UPDATE recordings SET verified=1,project_id=? WHERE id=?', [project, id])
  run('INSERT INTO transcripts(id,recording_id,text) VALUES (?,?,?)', ['transcript-' + filename, id, words])
  run('INSERT INTO segments(id,recording_id,start,end,text) VALUES (?,?,4,12,?)', ['segment-' + filename, id, words])
  return id
}
function index(id: string, axis: number): void { const document = searchDocument(id)!; expect(saveSearchDocument(document, document.chunks.map(() => vector(axis)), date)).toBe(true) }
function service(available = true): { search: SemanticSearch; download: ReturnType<typeof vi.fn>; runner: EmbeddingRunner } {
  const runner = { embed: vi.fn(async (texts: string[]) => texts.map(() => vector(0))), stop: vi.fn(async () => undefined) }, download = vi.fn(async () => undefined)
  const search = new SemanticSearch({ dataPath: '/unused-test-model', runner, modelAvailable: async () => available, download, now: () => new Date(date), changed: vi.fn() })
  services.push(search); return { search, download, runner }
}
describe('optional local semantic search', () => {
  it('stays disabled and downloads nothing on first run or with a missing model', async () => {
    const { search, download, runner } = service(false)
    await search.initialize()
    expect(search.state()).toMatchObject({ enabled: false, modelReady: false, setupOffered: false })
    expect(download).not.toHaveBeenCalled(); expect(runner.embed).not.toHaveBeenCalled()
    run("INSERT INTO settings VALUES ('semantic-enabled','true')")
    await search.initialize()
    expect(search.state().enabled).toBe(false); expect(download).not.toHaveBeenCalled()
  })
  it('downloads only after enabling, indexes saved recordings, and can be disabled without losing notes', async () => {
    const id = recording('plan.hda', 'Discuss the next steps')
    const { search, download } = service(false)
    await search.initialize(); search.enable()
    await vi.waitFor(() => expect(search.state().phase).toBe('ready'))
    expect(download).toHaveBeenCalledOnce()
    expect(search.state()).toMatchObject({ enabled: true, setupOffered: true, modelReady: true, indexedRecordings: 1 })
    await search.disable()
    expect(search.state()).toMatchObject({ enabled: false, modelReady: true })
    expect(queryOne('SELECT text FROM transcripts WHERE recording_id=?', [id])).toEqual({ text: 'Discuss the next steps' })
  })
  it('ranks cached embeddings with no keyword overlap while respecting project scope', async () => {
    const project = createProject('Work')
    const first = recording('borrowing.hda', 'The lender charges interest on the outstanding loan.', project.id)
    const other = recording('gardening.hda', 'Water the plants and prune the roses.')
    index(first, 0); index(other, 1)
    const hits = await semanticHits(vector(0), project.id, true)
    expect(hits.map(hit => hit.recordingId)).toEqual([first])
    expect(semanticCitations(hits)[0]).toMatchObject({ recordingId: first, start: 4, excerpt: '[4.00s] Unknown speaker: The lender charges interest on the outstanding loan.' })
  })
  it('combines keyword and meaning matches and returns the source passage for Library', async () => {
    const first = recording('loan.hda', 'The lender charges interest.'), second = recording('plants.hda', 'Water the roses.')
    index(first, 0); index(second, 1)
    const { search } = service()
    await search.initialize(); search.enable(); await vi.waitFor(() => expect(search.state().phase).toBe('ready'))
    // Keep the independent gardening document distinct from the query vector.
    index(second, 1)
    const matches = await search.search('borrowing costs', '', 'meaning')
    expect(matches.map(match => match.id)).toEqual([first])
    expect(matches[0].searchMatch).toMatchObject({ start: 4, excerpt: 'The lender charges interest.' })
    expect(await search.search('roses', '', 'keywords')).toHaveLength(1)
  })
  it('invalidates changed text immediately and never publishes a stale index over a correction', async () => {
    const id = recording('plan.hda', 'Old wording'); index(id, 0)
    const previous = searchDocument(id)!
    run("UPDATE segments SET text='Corrected wording' WHERE recording_id=?", [id])
    run("UPDATE transcripts SET text='Corrected wording' WHERE recording_id=?", [id])
    expect(queryAll('SELECT * FROM semantic_documents')).toEqual([])
    expect(await semanticHits(vector(0))).toEqual([])
    expect(saveSearchDocument(previous, previous.chunks.map(() => vector(0)), date)).toBe(false)
    index(id, 0)
    expect(semanticCitations(await semanticHits(vector(0), null, true))[0].excerpt).toContain('Corrected wording')
  })
  it('excludes deleted recordings and recordings indexed by a different model version', async () => {
    const id = recording('plan.hda', 'Discuss the plan'); index(id, 0)
    run("UPDATE semantic_documents SET model='old-model'")
    expect(await semanticHits(vector(0))).toEqual([])
    run('UPDATE semantic_documents SET model=?', [SEARCH_MODEL_ID]); run('DELETE FROM recordings WHERE id=?', [id])
    expect(queryAll('SELECT * FROM semantic_chunks')).toEqual([])
  })
  it('rejects invalid vectors instead of storing unusable model output', () => {
    expect(() => vectorBytes([1, 2])).toThrow('invalid embedding')
    expect(() => vectorBytes(new Array(384).fill(0))).toThrow('empty embedding')
    const invalid = vector(0); invalid[2] = NaN
    expect(() => vectorBytes(invalid)).toThrow('invalid embedding')
  })
  it('keeps keyword retrieval available when optional model inference fails', async () => {
    recording('plan.hda', 'Discuss the plan')
    const { search, runner } = service(); await search.initialize()
    search.enable(); await vi.waitFor(() => expect(search.state().phase).toBe('ready'))
    vi.mocked(runner.embed).mockRejectedValueOnce(new Error('Model unavailable'))
    expect(await search.citations('What was agreed?', null)).toEqual([])
    expect(search.state()).toMatchObject({ phase: 'failed', error: expect.stringContaining('keyword search') })
    expect(await search.search('plan', '', 'keywords')).toHaveLength(1)
  })
})
