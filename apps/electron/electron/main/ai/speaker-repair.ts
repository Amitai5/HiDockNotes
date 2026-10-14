import { queryAll, run, runInTransaction } from '../services/database'
import { groupSpeakerFragments } from './speaker-grouping'
import { MAX_MEETING_PARTICIPANTS } from '../../../src/shared/meeting'
import { embeddingBytes } from './voice-matching'

interface SavedSpeaker { id: string; label: string; label_source: string; voice_profile_id: string | null; embedding: Buffer | null; weight: number }
function vector(value: Buffer | null): number[] | null {
  if (!value || !value.length || value.length % 4 !== 0) return null
  const items = Array.from({ length: value.length / 4 }, (_, index) => value.readFloatLE(index * 4))
  return items.every(Number.isFinite) ? items : null
}
export function repairRecordingSpeakers(id: string): boolean {
  const rows = queryAll<SavedSpeaker>('SELECT s.*, sum(t.end-t.start) AS weight FROM speakers s JOIN segments t ON t.speaker_id=s.id WHERE s.recording_id=? GROUP BY s.id ORDER BY min(t.start),s.rowid', [id])
  if (rows.length <= MAX_MEETING_PARTICIPANTS) return false
  const grouped = groupSpeakerFragments(rows.map(row => ({ id: row.id, vector: vector(row.embedding), weight: row.weight, identity: row.label_source === 'manual' ? row.voice_profile_id ?? 'manual:' + row.label.toLowerCase() : row.voice_profile_id ?? undefined })))
  runInTransaction(() => {
    for (const [index, group] of grouped.groups.entries()) {
      for (const member of group.members) if (member !== group.root) run('UPDATE segments SET speaker_id=? WHERE recording_id=? AND speaker_id=?', [group.root, id, member])
      if (!group.identity) run('UPDATE speakers SET label=?,embedding=?,voice_profile_id=NULL,suggested_profile_id=NULL,match_score=NULL WHERE id=?', [`Unknown speaker ${index + 1}`, group.vector ? embeddingBytes(group.vector) : null, group.root])
    }
    for (const member of grouped.unassigned) run('UPDATE segments SET speaker_id=NULL WHERE recording_id=? AND speaker_id=?', [id, member])
    // Keep confirmed voice-sample provenance. Orphans never appear as current participants.
    run("DELETE FROM speakers WHERE recording_id=? AND label_source<>'manual' AND NOT EXISTS(SELECT 1 FROM segments t WHERE t.speaker_id=speakers.id) AND NOT EXISTS(SELECT 1 FROM voice_samples v WHERE v.speaker_id=speakers.id)", [id])
    run('INSERT INTO recording_overviews(recording_id,speaker_limited) VALUES (?,?) ON CONFLICT(recording_id) DO UPDATE SET speaker_limited=excluded.speaker_limited', [id, Number(grouped.limited)])
    const transcript = queryAll<{ start: number; end: number; text: string; label: string | null }>('SELECT t.start,t.end,t.text,s.label FROM segments t LEFT JOIN speakers s ON s.id=t.speaker_id WHERE t.recording_id=? ORDER BY t.start', [id]).map(item => `[${item.start.toFixed(2)}-${item.end.toFixed(2)}] ${item.label ?? 'Unknown speaker'}: ${item.text}`).join('\n')
    run('UPDATE transcripts SET text=? WHERE recording_id=?', [transcript, id])
  })
  return true
}
export function repairFragmentedSpeakers(): number {
  const ids = queryAll<{ recording_id: string }>('SELECT s.recording_id FROM speakers s WHERE EXISTS(SELECT 1 FROM segments t WHERE t.speaker_id=s.id) GROUP BY s.recording_id HAVING count(*)>?', [MAX_MEETING_PARTICIPANTS])
  let repaired = 0
  for (const { recording_id } of ids) if (repairRecordingSpeakers(recording_id)) repaired++
  // The display query also excludes historical rows in recordings that already have a valid count.
  return repaired
}
