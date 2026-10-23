import { join } from 'node:path'
import { getDatabase, queryAll, run, runInTransaction } from '../services/database'
import { decoderArtifactReason } from './local-speech'
import { transcriptContent } from './providers'
import type { TranscriptSegment } from '../../../src/shared/contracts'

interface Artifact { segment_id: string; recording_id: string; start: number; end: number; text: string; speaker_id: string | null; reason: string }
export function findDecoderArtifacts(): Artifact[] {
  return queryAll<Omit<Artifact, 'reason'>>("SELECT s.id AS segment_id,s.recording_id,s.start,s.end,s.text,s.speaker_id FROM segments s JOIN transcripts t ON t.recording_id=s.recording_id WHERE t.provider='local' AND NOT EXISTS(SELECT 1 FROM transcript_corrections c WHERE c.recording_id=s.recording_id AND c.segment_id=s.id)").flatMap(segment => {
    const reason = decoderArtifactReason(segment.text)
    return reason ? [{ ...segment, reason }] : []
  })
}
/** Retains the removed rows for recovery and never rewrites real words or labels. */
export function quarantineDecoderArtifacts(artifacts: Artifact[], removedAt: string): number {
  return runInTransaction(() => {
    const affected = new Set<string>()
    for (const item of artifacts) {
      // A stale scan cannot delete an edited segment.
      if (!run('INSERT OR IGNORE INTO transcript_artifacts(segment_id,recording_id,start,end,text,speaker_id,reason,removed_at) SELECT id,recording_id,start,end,text,speaker_id,?,? FROM segments WHERE id=? AND text=? AND start=? AND end=?', [item.reason, removedAt, item.segment_id, item.text, item.start, item.end]).changes) continue
      run('DELETE FROM segments WHERE id=?', [item.segment_id]); affected.add(item.recording_id)
    }
    for (const id of affected) {
      const segments = queryAll<TranscriptSegment>('SELECT s.id,s.start,s.end,s.text,s.speaker_id AS speakerId,p.label AS speakerName FROM segments s LEFT JOIN speakers p ON p.id=s.speaker_id WHERE s.recording_id=? ORDER BY s.start', [id])
      run('UPDATE transcripts SET text=? WHERE recording_id=?', [transcriptContent(segments), id])
    }
    return affected.size
  })
}
export async function repairSavedDecoderArtifacts(dataPath: string): Promise<{ recordings: number; segments: number }> {
  const artifacts = findDecoderArtifacts()
  if (!artifacts.length) return { recordings: 0, segments: 0 }
  // Use SQLite's backup API so uncheckpointed WAL changes are included. If the
  // backup fails, the original transcript is left completely untouched.
  await getDatabase().backup(join(dataPath, 'data', `library-before-transcript-quality-v4-${Date.now()}.db`))
  return { recordings: quarantineDecoderArtifacts(artifacts, new Date().toISOString()), segments: artifacts.length }
}
