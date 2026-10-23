import type { TranscriptSegment } from '../../../src/shared/contracts'
import type { TranscriptCandidateChoice, TranscriptReview } from '../../../src/shared/transcript'
import type { AISettings } from '../../../src/shared/ai'
import type { TranscriptCheckpoint } from '../ai/backend'
import { transcriptContent } from '../ai/providers'
import { queryAll, queryOne, run, runInTransaction } from './database'

interface RevisionRow { version: number; created_at: string; reason: string; segment_count: number; segments: string; corrections: string }
interface Correction { segment_id: string; start: number; end: number; text: string }
interface CandidateRow { created_at: string; checkpoint: string; settings: string }
export function currentSegments(id: string): TranscriptSegment[] {
  return queryAll<TranscriptSegment>('SELECT t.id,t.start,t.end,t.text,t.speaker_id AS speakerId,p.label AS speakerName FROM segments t LEFT JOIN speakers p ON p.id=t.speaker_id WHERE t.recording_id=? ORDER BY t.start,t.end,t.id', [id])
}
function corrections(id: string): Correction[] { return queryAll<Correction>('SELECT segment_id,start,end,text FROM transcript_corrections WHERE recording_id=? ORDER BY start', [id]) }
export function transcriptVersion(id: string): number { return queryOne<{ version: number }>('SELECT MAX(version) AS version FROM transcript_revisions WHERE recording_id=?', [id])?.version ?? 0 }
export function hasTranscriptCorrections(id: string): boolean { return !!queryOne('SELECT segment_id FROM transcript_corrections WHERE recording_id=? LIMIT 1', [id]) }
export function rememberTranscript(id: string, reason: string): void {
  const current = currentSegments(id), segments = JSON.stringify(current), edits = JSON.stringify(corrections(id))
  const latest = queryOne<RevisionRow>('SELECT * FROM transcript_revisions WHERE recording_id=? ORDER BY version DESC LIMIT 1', [id])
  if (latest?.segments === segments && latest.corrections === edits || !latest && segments === '[]') return
  run('INSERT INTO transcript_revisions(recording_id,created_at,reason,segment_count,segments,corrections) VALUES (?,?,?,?,?,?)', [id, new Date().toISOString(), reason, current.length, segments, edits])
}
function assertEditable(id: unknown, version: unknown): asserts id is string {
  if (typeof id !== 'string' || id.length > 200 || !queryOne('SELECT id FROM recordings WHERE id=?', [id])) throw new Error('Recording was not found.')
  if (!Number.isSafeInteger(version) || version !== transcriptVersion(id)) throw new Error('The transcript changed. Reload it before saving your correction.')
  if (queryOne('SELECT recording_id FROM recording_deletions WHERE recording_id=?', [id])) throw new Error('This recording is being deleted.')
  if (queryOne("SELECT id FROM transcription_jobs WHERE recording_id=? AND stage NOT IN ('done','empty','failed')", [id])) throw new Error('Wait for this recording to finish processing before editing.')
}
function refreshText(id: string): void {
  run('UPDATE transcripts SET text=? WHERE recording_id=?', [transcriptContent(currentSegments(id)), id])
}
export function editTranscript(id: unknown, segmentId: unknown, text: unknown, version: unknown): void {
  assertEditable(id, version)
  if (typeof segmentId !== 'string' || typeof text !== 'string' || !text.trim() || text.length > 30000) throw new Error('Enter transcript text between 1 and 30,000 characters.')
  const segment = queryOne<{ start: number; end: number; text: string }>('SELECT start,end,text FROM segments WHERE recording_id=? AND id=?', [id, segmentId])
  if (!segment) throw new Error('Transcript excerpt was not found.')
  if (segment.text === text.trim()) return
  runInTransaction(() => {
    rememberTranscript(id, 'Original transcript')
    run('UPDATE segments SET text=? WHERE id=? AND recording_id=?', [text.trim(), segmentId, id])
    run('INSERT INTO transcript_corrections(recording_id,segment_id,start,end,text) VALUES (?,?,?,?,?) ON CONFLICT(recording_id,segment_id) DO UPDATE SET text=excluded.text', [id, segmentId, segment.start, segment.end, text.trim()])
    refreshText(id); rememberTranscript(id, 'Edited transcript')
  })
}
export function revisionSegments(id: unknown, version: unknown): TranscriptSegment[] {
  if (typeof id !== 'string' || !Number.isSafeInteger(version)) throw new Error('Invalid transcript revision.')
  const row = queryOne<RevisionRow>('SELECT * FROM transcript_revisions WHERE recording_id=? AND version=?', [id, version])
  if (!row) throw new Error('Transcript revision was not found.')
  return JSON.parse(row.segments) as TranscriptSegment[]
}
export function restoreTranscriptRevision(id: unknown, target: unknown, expected: unknown): void {
  assertEditable(id, expected)
  const segments = revisionSegments(id, target)
  const row = queryOne<RevisionRow>('SELECT * FROM transcript_revisions WHERE recording_id=? AND version=?', [id, target])!
  runInTransaction(() => {
    rememberTranscript(id, 'Before restoring a revision')
    run('DELETE FROM segments WHERE recording_id=?', [id])
    for (const segment of segments) {
      if (segment.speakerId && !queryOne('SELECT id FROM speakers WHERE id=? AND recording_id=?', [segment.speakerId, id])) run("INSERT INTO speakers(id,recording_id,label,label_source) VALUES (?,?,?,'manual')", [segment.speakerId, id, segment.speakerName ?? 'Unknown speaker'])
      run('INSERT INTO segments(id,recording_id,start,end,text,speaker_id) VALUES (?,?,?,?,?,?)', [segment.id, id, segment.start, segment.end, segment.text, segment.speakerId])
    }
    run('DELETE FROM transcript_corrections WHERE recording_id=?', [id])
    // Restoring a historical transcript is itself an explicit manual correction.
    for (const segment of segments) run('INSERT INTO transcript_corrections VALUES (?,?,?,?,?)', [id, segment.id, segment.start, segment.end, segment.text])
    refreshText(id); rememberTranscript(id, `Restored revision ${row.version}`)
  })
}
export function stageTranscriptCandidate(id: string, checkpoint: TranscriptCheckpoint, settings: AISettings): void {
  run('INSERT INTO transcript_candidates(recording_id,created_at,checkpoint,settings) VALUES (?,?,?,?) ON CONFLICT(recording_id) DO UPDATE SET created_at=excluded.created_at,checkpoint=excluded.checkpoint,settings=excluded.settings', [id, new Date().toISOString(), JSON.stringify(checkpoint), JSON.stringify(settings)])
}
function mergedSegments(id: string, candidate: TranscriptCheckpoint): TranscriptSegment[] {
  const edited = new Set(corrections(id).map(item => item.segment_id))
  const retained = currentSegments(id).filter(segment => edited.has(segment.id))
  return [...candidate.segments.filter(segment => !retained.some(edit => segment.start < edit.end && segment.end > edit.start)), ...retained].sort((a, b) => a.start - b.start || a.end - b.end)
}
export function transcriptReview(id: unknown): TranscriptReview {
  if (typeof id !== 'string' || !queryOne('SELECT id FROM recordings WHERE id=?', [id])) throw new Error('Recording was not found.')
  const row = queryOne<CandidateRow>('SELECT * FROM transcript_candidates WHERE recording_id=?', [id])
  const checkpoint = row ? JSON.parse(row.checkpoint) as TranscriptCheckpoint : null
  const summaryVersion = queryOne<{ summary_version: number }>('SELECT summary_version FROM recording_overviews WHERE recording_id=?', [id])
  const version = transcriptVersion(id)
  return { version, correctedSegments: corrections(id).map(item => item.segment_id), summaryStale: !!queryOne('SELECT id FROM summaries WHERE recording_id=?', [id]) && version > (summaryVersion?.summary_version ?? 0),
    revisions: queryAll<RevisionRow>('SELECT version,created_at,reason,segment_count FROM transcript_revisions WHERE recording_id=? ORDER BY version DESC', [id]).map(item => ({ version: item.version, createdAt: item.created_at, reason: item.reason, segmentCount: item.segment_count })),
    candidate: row && checkpoint ? { createdAt: row.created_at, segments: checkpoint.segments, merged: mergedSegments(id, checkpoint), corrections: corrections(id).length } : null }
}
/** Produces an explicit, previewable merge; no word positions or speaker identities are guessed. */
export function chooseTranscriptCandidate(id: unknown, choice: unknown, version: unknown): { checkpoint: TranscriptCheckpoint; settings: AISettings; replaceCorrections: boolean } | null {
  assertEditable(id, version)
  if (!['keep-corrections', 'replace', 'discard'].includes(choice as TranscriptCandidateChoice)) throw new Error('Choose how to apply the new transcript.')
  const row = queryOne<CandidateRow>('SELECT * FROM transcript_candidates WHERE recording_id=?', [id])
  if (!row) throw new Error('No new transcription is waiting for review.')
  if (choice === 'discard') { run('DELETE FROM transcript_candidates WHERE recording_id=?', [id]); return null }
  const checkpoint = JSON.parse(row.checkpoint) as TranscriptCheckpoint
  if (choice === 'keep-corrections') checkpoint.segments = mergedSegments(id, checkpoint)
  // Keep manually named speakers for the retained excerpts, even if cluster IDs changed.
  for (const segment of checkpoint.segments) if (segment.speakerId && !checkpoint.speakers.some(speaker => speaker.id === segment.speakerId)) {
    const speaker = queryOne<{ label: string; voice_profile_id: string | null }>('SELECT label,voice_profile_id FROM speakers WHERE id=?', [segment.speakerId])
    checkpoint.speakers.push({ id: segment.speakerId, label: speaker?.label ?? segment.speakerName ?? 'Unknown speaker', profileId: speaker?.voice_profile_id ?? null, suggestedId: null, score: null, embedding: null })
  }
  return { checkpoint, settings: JSON.parse(row.settings) as AISettings, replaceCorrections: choice === 'replace' }
}
