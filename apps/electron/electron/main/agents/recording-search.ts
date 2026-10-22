import type { AgentDatabaseReader } from './library-tools'
import type { MeaningMatches } from '../search/semantic-index'

interface RecordingRow { id: string; filename: string; title: string | null; recordedAt: string; durationSeconds: number | null; status: string; projectId: string | null }
interface KeywordRow extends RecordingRow { excerpt: string }
export type AgentMeaningSearch = (query: string, projectId: string | null | undefined, signal?: AbortSignal) => Promise<MeaningMatches>
interface SearchOptions { query: string; projectId?: string | null; limit: number; offset: number; mode: 'keywords' | 'meaning' }
const columns = 'r.id,r.filename,r.title,r.date_recorded AS recordedAt,r.duration_seconds AS durationSeconds,r.status,r.project_id AS projectId'
const MARKER = '\u0001'
function scope(projectId: string | null | undefined, parameters: unknown[]): string {
  if (projectId === undefined) return ''
  if (projectId === null) return ' AND r.project_id IS NULL'
  parameters.push(projectId); return ' AND r.project_id=?'
}
function terms(query: string): string { return query.trim().split(/\s+/).map(term => '"' + term.replaceAll('"', '""') + '"*').join(' AND ') }
function keywords(database: AgentDatabaseReader, options: SearchOptions): KeywordRow[] {
  const parameters: unknown[] = [MARKER, terms(options.query)]
  const where = scope(options.projectId, parameters)
  const pagination = options.mode === 'keywords' ? ' LIMIT ? OFFSET ?' : ''
  if (pagination) parameters.push(options.limit + 1, options.offset)
  return database.all<KeywordRow>(`SELECT ${columns},snippet(recording_fts,-1,?,'',' … ',40) AS excerpt FROM recording_fts JOIN recordings r ON r.id=recording_fts.recording_id WHERE recording_fts MATCH ?${where} ORDER BY bm25(recording_fts),r.date_recorded DESC,r.id${pagination}`, parameters)
}
function keywordPassage(database: AgentDatabaseReader, row: KeywordRow, query: string): { kind: 'keywords'; source: 'transcript' | 'recording'; excerpt: string; start: number | null; end: number | null } {
  const words = query.trim().split(/\s+/)
  const conditions = words.map(() => "s.text LIKE ? ESCAPE '\\'").join(' AND ')
  const patterns = words.map(word => '%' + word.replace(/[\\%_]/g, '\\$&') + '%')
  const segment = database.one<{ start: number; end: number; text: string }>(`SELECT s.start,s.end,s.text FROM segments s WHERE s.recording_id=? AND ${conditions} ORDER BY s.start,s.rowid LIMIT 1`, [row.id, ...patterns])
  if (!segment) return { kind: 'keywords', source: 'recording', excerpt: row.excerpt.replaceAll(MARKER, '').slice(0, 600), start: null, end: null }
  const positions = words.map(word => segment.text.toLowerCase().indexOf(word.toLowerCase())).filter(position => position >= 0)
  const start = positions.length ? Math.max(0, Math.min(...positions) - 100) : 0
  return { kind: 'keywords', source: 'transcript', excerpt: (start ? '… ' : '') + segment.text.slice(start, start + 600), start: segment.start, end: segment.end }
}
function keywordPage(database: AgentDatabaseReader, options: SearchOptions, rows: KeywordRow[], fallbackReason: string | null = null): unknown {
  const start = options.mode === 'keywords' ? 0 : options.offset
  return { recordings: rows.slice(start, start + options.limit).map(row => { const match = keywordPassage(database, row, options.query); return { ...row, excerpt: match.excerpt, match } }), nextOffset: rows.length > start + options.limit ? options.offset + options.limit : null, requestedMode: options.mode, mode: 'keywords', fallbackReason, indexing: false, semanticResultsTruncated: false }
}

/** Preserves keyword-only calls while optional inference runs asynchronously in its existing worker. */
export function searchAgentRecordings(database: AgentDatabaseReader, options: SearchOptions, meaning?: AgentMeaningSearch, signal?: AbortSignal): unknown {
  signal?.throwIfAborted()
  if (options.mode === 'keywords') return keywordPage(database, options, keywords(database, options))
  return meaningPage(database, options, meaning, signal)
}
async function meaningPage(database: AgentDatabaseReader, options: SearchOptions, meaning?: AgentMeaningSearch, signal?: AbortSignal): Promise<unknown> {
  const matches = meaning ? await meaning(options.query, options.projectId, signal) : { hits: [], fallbackReason: 'Enable and download local meaning search in Settings to search by meaning.', indexing: false, truncated: false }
  signal?.throwIfAborted()
  const rows = keywords(database, options)
  if (matches.fallbackReason) return keywordPage(database, options, rows, matches.fallbackReason)
  const candidates = new Map<string, RecordingRow>()
  // Reread scoped metadata after inference: recordings may have been deleted or
  // moved to another folder while the worker was running.
  const ids = [...new Set([...rows.map(row => row.id), ...matches.hits.map(hit => hit.recordingId)])]
  for (let position = 0; position < ids.length; position += 250) {
    const batch = ids.slice(position, position + 250), parameters: unknown[] = [...batch]
    const where = scope(options.projectId, parameters)
    for (const row of database.all<RecordingRow>(`SELECT ${columns} FROM recordings r WHERE r.id IN (${batch.map(() => '?').join(',')})${where}`, parameters)) candidates.set(row.id, row)
  }
  const scores = new Map<string, number>()
  rows.filter(row => candidates.has(row.id)).forEach((row, index) => scores.set(row.id, 1 / (60 + index)))
  const hits = new Map(matches.hits.filter(hit => candidates.has(hit.recordingId)).map((hit, index) => {
    scores.set(hit.recordingId, (scores.get(hit.recordingId) ?? 0) + 1 / (60 + index)); return [hit.recordingId, hit] as const
  }))
  const ranked = [...scores].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const recordings = ranked.slice(options.offset, options.offset + options.limit).map(([id, score]) => {
    const row = candidates.get(id)!, hit = hits.get(id)
    let match: { kind: 'keywords' | 'meaning'; source: 'transcript' | 'summary' | 'recording'; excerpt: string; start: number | null; end: number | null }
    if (hit?.kind === 'transcript') {
      const segments = database.all<{ start: number; end: number; text: string }>('SELECT start,end,text FROM segments WHERE recording_id=? AND end>? AND start<=? ORDER BY start,rowid LIMIT 16', [id, hit.start, hit.end])
      match = { kind: 'meaning', source: 'transcript', excerpt: segments.map(segment => segment.text).join('\n').slice(0, 600), start: segments[0]?.start ?? null, end: segments.at(-1)?.end ?? null }
    } else if (hit) {
      match = { kind: 'meaning', source: 'summary', excerpt: hit.text.slice(0, 600), start: null, end: null }
    } else match = keywordPassage(database, rows.find(item => item.id === id)!, options.query)
    return { ...row, excerpt: match.excerpt, match, score }
  })
  return { recordings, nextOffset: ranked.length > options.offset + options.limit ? options.offset + options.limit : null, requestedMode: options.mode, mode: 'meaning', fallbackReason: null, indexing: matches.indexing, semanticResultsTruncated: matches.truncated }
}
