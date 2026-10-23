import { randomUUID } from 'node:crypto'
import type { VoiceProfileView } from '../../../src/shared/ai'
import { getDetail, queryAll, queryOne, run, runInTransaction } from '../services/database'
import { embeddingFromBytes, type VoiceCandidate } from './voice-matching'
import { transcriptContent } from './providers'

export const MAX_VOICE_SAMPLES = 10
function nameValue(value: string): string {
  const name = value.trim()
  if (!name || name.length > 80 || /[\u0000-\u001f]/.test(name)) throw new Error('Use a voice name between 1 and 80 characters.')
  return name
}
function refreshTranscript(recordingId: string): void {
  run('UPDATE transcripts SET text=? WHERE recording_id=?', [transcriptContent(getDetail(recordingId).segments), recordingId])
}
export function voiceCandidates(): VoiceCandidate[] {
  return queryAll<{ id: string; name: string }>('SELECT id, name FROM voice_profiles').map(profile => ({ ...profile, embeddings: queryAll<{ embedding: Buffer }>('SELECT embedding FROM voice_samples WHERE voice_profile_id=? ORDER BY created_at DESC', [profile.id]).map(row => embeddingFromBytes(row.embedding)).filter(v => v.length > 0) }))
}
export function listVoiceProfiles(): VoiceProfileView[] {
  return queryAll<{ id: string; name: string }>('SELECT id, name FROM voice_profiles ORDER BY name').map(profile => ({ ...profile, samples: queryAll('SELECT v.id, v.source_recording AS recordingId, COALESCE(r.title,r.filename) AS recordingTitle, v.created_at AS createdAt FROM voice_samples v LEFT JOIN recordings r ON r.id=v.source_recording WHERE v.voice_profile_id=? ORDER BY v.created_at DESC, v.rowid DESC', [profile.id]) }))
}
function boundSamples(profileId: string): void {
  run('DELETE FROM voice_samples WHERE voice_profile_id=? AND id NOT IN (SELECT id FROM voice_samples WHERE voice_profile_id=? ORDER BY created_at DESC, rowid DESC LIMIT ?)', [profileId, profileId, MAX_VOICE_SAMPLES])
}
export function nameSpeaker(speakerId: string, value: string): void {
  const name = nameValue(value)
  const speaker = queryOne<{ recording_id: string; embedding: Buffer | null }>('SELECT recording_id, embedding FROM speakers WHERE id=?', [speakerId])
  if (!speaker) throw new Error('Speaker was not found.')
  runInTransaction(() => {
    const profileId = queryOne<{ id: string }>('SELECT id FROM voice_profiles WHERE lower(name)=lower(?)', [name])?.id ?? randomUUID()
    run('INSERT OR IGNORE INTO voice_profiles(id, name, created_at) VALUES (?, ?, ?)', [profileId, name, new Date().toISOString()])
    // Correcting a wrong label removes that exact speaker's sample from the
    // previous profile. Other recordings' samples remain untouched.
    run('DELETE FROM voice_samples WHERE speaker_id=?', [speakerId])
    if (speaker.embedding && embeddingFromBytes(speaker.embedding).length) {
      run('INSERT INTO voice_samples(id, voice_profile_id, embedding, source_recording, created_at, speaker_id) VALUES (?, ?, ?, ?, ?, ?)', [randomUUID(), profileId, speaker.embedding, speaker.recording_id, new Date().toISOString(), speakerId])
      boundSamples(profileId)
    }
    run("UPDATE speakers SET label=?, voice_profile_id=?, suggested_profile_id=NULL, match_score=1, label_source='manual' WHERE id=?", [name, profileId, speakerId])
    refreshTranscript(speaker.recording_id)
  })
}
/** Assigns one previously unidentified segment without enrolling mixed or unknown audio. */
export function assignSegment(recordingId: string, segmentId: string, value: string): void {
  const name = nameValue(value)
  if (!queryOne('SELECT id FROM segments WHERE id=? AND recording_id=?', [segmentId, recordingId])) throw new Error('Transcript segment was not found.')
  if (queryOne("SELECT id FROM transcription_jobs WHERE recording_id=? AND stage NOT IN ('done','empty','failed')", [recordingId])) throw new Error('Wait for processing to finish before assigning this segment.')
  runInTransaction(() => {
    let speaker = queryOne<{ id: string }>("SELECT id FROM speakers WHERE recording_id=? AND lower(label)=lower(?) AND label_source='manual'", [recordingId, name])
    if (!speaker) {
      const profile = queryOne<{ id: string }>('SELECT id FROM voice_profiles WHERE lower(name)=lower(?)', [name])
      speaker = { id: randomUUID() }
      run("INSERT INTO speakers(id,recording_id,label,voice_profile_id,label_source) VALUES (?,?,?,?,'manual')", [speaker.id, recordingId, name, profile?.id ?? null])
    }
    run('UPDATE segments SET speaker_id=? WHERE id=? AND recording_id=?', [speaker.id, segmentId, recordingId])
    refreshTranscript(recordingId)
  })
}
export function confirmSpeaker(id: string): void {
  const row = queryOne<{ name: string }>('SELECT p.name FROM speakers s JOIN voice_profiles p ON p.id=s.suggested_profile_id WHERE s.id=?', [id])
  if (!row) throw new Error('This speaker has no current voice suggestion.')
  nameSpeaker(id, row.name)
}
export function renameVoiceProfile(id: string, value: string): void {
  const name = nameValue(value)
  if (queryOne('SELECT id FROM voice_profiles WHERE lower(name)=lower(?) AND id<>?', [name, id])) throw new Error('A voice with this name already exists. Merge the profiles to combine them.')
  runInTransaction(() => {
    if (!run('UPDATE voice_profiles SET name=? WHERE id=?', [name, id]).changes) throw new Error('Voice profile was not found.')
    const recordings = queryAll<{ recording_id: string }>('SELECT DISTINCT recording_id FROM speakers WHERE voice_profile_id=?', [id])
    run('UPDATE speakers SET label=? WHERE voice_profile_id=?', [name, id])
    for (const row of recordings) refreshTranscript(row.recording_id)
  })
}
export function mergeVoiceProfiles(source: string, target: string): void {
  if (source === target) throw new Error('Choose two different voice profiles.')
  const into = queryOne<{ name: string }>('SELECT name FROM voice_profiles WHERE id=?', [target])
  if (!into || !queryOne('SELECT id FROM voice_profiles WHERE id=?', [source])) throw new Error('Voice profile was not found.')
  runInTransaction(() => {
    const recordings = queryAll<{ recording_id: string }>('SELECT DISTINCT recording_id FROM speakers WHERE voice_profile_id=?', [source])
    run('DELETE FROM voice_samples WHERE voice_profile_id=? AND speaker_id IN (SELECT speaker_id FROM voice_samples WHERE voice_profile_id=? AND speaker_id IS NOT NULL)', [source, target])
    run('UPDATE voice_samples SET voice_profile_id=? WHERE voice_profile_id=?', [target, source])
    run('UPDATE speakers SET voice_profile_id=?, label=? WHERE voice_profile_id=?', [target, into.name, source])
    run('UPDATE speakers SET suggested_profile_id=? WHERE suggested_profile_id=?', [target, source])
    run('DELETE FROM voice_profiles WHERE id=?', [source])
    boundSamples(target)
    for (const row of recordings) refreshTranscript(row.recording_id)
  })
}
export function deleteVoiceProfile(id: string): void {
  // Preserve the speaker labels in existing transcripts; erase recognition data.
  if (!run('DELETE FROM voice_profiles WHERE id=?', [id]).changes) throw new Error('Voice profile was not found.')
}
export function deleteVoiceSample(id: string): void { if (!run('DELETE FROM voice_samples WHERE id=?', [id]).changes) throw new Error('Voice sample was not found.') }
