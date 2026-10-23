import { createHash } from 'node:crypto'
import type { RecordingCitation } from '../../../src/shared/ai'
import { queryAll, queryOne, run, runInTransaction } from '../services/database'
import { SEARCH_MODEL_ID } from './semantic-model'

export interface SearchChunk { text: string; start: number; end: number; kind: 'transcript' | 'summary' }
export interface SearchDocument { id: string; fingerprint: string; chunks: SearchChunk[] }
export interface SemanticHit { recordingId: string; title: string; text: string; start: number; end: number; kind: SearchChunk['kind']; score: number; fingerprint?: string }
export interface MeaningMatches { hits: SemanticHit[]; fallbackReason: string | null; indexing: boolean; truncated: boolean }
export interface EmbeddingRunner { embed(texts: string[], signal?: AbortSignal): Promise<number[][]>; stop(): Promise<void> }
interface Segment { start: number; end: number; text: string; label: string | null }

export function searchDocument(id: string): SearchDocument | null {
  const recording = queryOne<{ title: string; summary: string | null }>('SELECT COALESCE(r.title,r.filename) AS title,s.text AS summary FROM recordings r LEFT JOIN summaries s ON s.recording_id=r.id WHERE r.id=? AND r.verified=1', [id])
  if (!recording) return null
  const segments = queryAll<Segment>('SELECT s.start,s.end,s.text,p.label FROM segments s LEFT JOIN speakers p ON p.id=s.speaker_id WHERE s.recording_id=? ORDER BY s.start,s.id', [id])
  const chunks: SearchChunk[] = []
  let current: SearchChunk | null = null
  for (const segment of segments) {
    const words = segment.text.trim().split(/\s+/).filter(Boolean)
    for (let offset = 0; offset < words.length; offset += 80) {
      const text = `${segment.label ? segment.label + ': ' : ''}${words.slice(offset, offset + 80).join(' ')}`
      if (current && (current.text.length + text.length > 850 || segment.end - current.start > 60)) { chunks.push(current); current = null }
      if (!current) current = { text: '', start: segment.start, end: segment.end, kind: 'transcript' }
      current.text += (current.text ? '\n' : '') + text; current.end = segment.end
    }
  }
  if (current) chunks.push(current)
  const notes = `${recording.title}\n${recording.summary ?? ''}`.trim().split(/\s+/)
  for (let offset = 0; offset < notes.length; offset += 100) chunks.push({ text: notes.slice(offset, offset + 100).join(' '), start: 0, end: 0, kind: 'summary' })
  return { id, chunks, fingerprint: createHash('sha256').update(JSON.stringify(chunks)).digest('hex') }
}
export function vectorBytes(vector: number[]): Buffer {
  if (vector.length !== 384 || vector.some(value => !Number.isFinite(value))) throw new Error('The search model returned an invalid embedding.')
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  if (!norm) throw new Error('The search model returned an empty embedding.')
  const result = Buffer.alloc(384 * 4)
  vector.forEach((value, index) => result.writeFloatLE(value / norm, index * 4))
  return result
}
export function saveSearchDocument(document: SearchDocument, vectors: number[][], now: string): boolean {
  if (vectors.length !== document.chunks.length) throw new Error('The search index is incomplete.')
  const embeddings = vectors.map(vectorBytes)
  return runInTransaction(() => {
    if (searchDocument(document.id)?.fingerprint !== document.fingerprint) return false
    run('DELETE FROM semantic_chunks WHERE recording_id=?', [document.id])
    for (let index = 0; index < document.chunks.length; index++) {
      const chunk = document.chunks[index]
      run('INSERT INTO semantic_chunks(recording_id,position,start,end,text,kind,embedding) VALUES (?,?,?,?,?,?,?)', [document.id, index, chunk.start, chunk.end, chunk.text, chunk.kind, embeddings[index]])
    }
    run('INSERT OR REPLACE INTO semantic_documents(recording_id,fingerprint,model,indexed_at) VALUES (?,?,?,?)', [document.id, document.fingerprint, SEARCH_MODEL_ID, now])
    return true
  })
}
export async function semanticHits(vector: number[], projectId: string | null = null, transcriptsOnly = false, options: { unfiledOnly?: boolean; limit?: number; signal?: AbortSignal } = {}): Promise<SemanticHit[]> {
  const normalized = vectorBytes(vector), query = Array.from({ length: 384 }, (_, index) => normalized.readFloatLE(index * 4))
  const best = new Map<string, SemanticHit>()
  let after = 0
  for (;;) {
    options.signal?.throwIfAborted()
    const rows = queryAll<{ id: number; recording_id: string; title: string; text: string; start: number; end: number; kind: SearchChunk['kind']; embedding: Buffer; fingerprint: string }>(`SELECT c.*,d.fingerprint,COALESCE(r.title,r.filename) AS title FROM semantic_chunks c JOIN recordings r ON r.id=c.recording_id JOIN semantic_documents d ON d.recording_id=r.id WHERE c.id>? AND r.verified=1 AND d.model=? AND (? IS NULL OR r.project_id=?)${options.unfiledOnly ? ' AND r.project_id IS NULL' : ''}${transcriptsOnly ? " AND c.kind='transcript'" : ''} ORDER BY c.id LIMIT 512`, [after, SEARCH_MODEL_ID, projectId, projectId])
    for (const row of rows) {
      if (row.embedding.length !== 384 * 4) continue
      let score = 0
      for (let index = 0; index < 384; index++) score += query[index] * row.embedding.readFloatLE(index * 4)
      if (score < 0.25 || score <= (best.get(row.recording_id)?.score ?? -1)) continue
      best.set(row.recording_id, { recordingId: row.recording_id, title: row.title, text: row.text, start: row.start, end: row.end, kind: row.kind, score, fingerprint: row.fingerprint })
    }
    if (rows.length < 512) break
    after = rows[rows.length - 1].id
    await new Promise<void>(resolve => setImmediate(resolve))
  }
  const current = new Map(queryAll<{ recording_id: string; fingerprint: string }>('SELECT recording_id,fingerprint FROM semantic_documents WHERE model=?', [SEARCH_MODEL_ID]).map(row => [row.recording_id, row.fingerprint]))
  return [...best.values()].filter(hit => current.get(hit.recordingId) === hit.fingerprint).sort((a, b) => b.score - a.score || a.recordingId.localeCompare(b.recordingId)).slice(0, options.limit ?? 30)
}
/** Citations always reread the current transcript instead of treating cached model text as evidence. */
export function semanticCitations(hits: SemanticHit[]): RecordingCitation[] {
  return hits.slice(0, 6).flatMap(hit => {
    const segments = queryAll<Segment>('SELECT s.start,s.end,s.text,p.label FROM segments s LEFT JOIN speakers p ON p.id=s.speaker_id WHERE s.recording_id=? AND s.end>=? AND s.start<=? ORDER BY s.start LIMIT 16', [hit.recordingId, Math.max(0, hit.start - 5), hit.end + 5])
    if (!segments.length) return []
    return [{ number: 0, recordingId: hit.recordingId, title: hit.title, start: segments[0].start, excerpt: segments.map(segment => `[${segment.start.toFixed(2)}s] ${segment.label ?? 'Unknown speaker'}: ${segment.text}`).join('\n').slice(0, 6000) }]
  }).map((citation, index) => ({ ...citation, number: index + 1 }))
}
