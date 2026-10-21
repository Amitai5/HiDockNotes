import { randomUUID } from 'node:crypto'
import type { AISettings } from '../../../src/shared/ai'
import { queryAll, queryOne, run, runInTransaction, type Recording } from '../services/database'
import { embeddingBytes } from './voice-matching'
import { getDetail } from '../services/database'
import { transcriptContent } from './providers'
import type { ProcessingResult, TranscriptCheckpoint } from './backend'
import { rememberTranscript, transcriptVersion } from '../services/transcript-revisions'

export function saveTranscript(id: string, checkpoint: TranscriptCheckpoint, settings: AISettings): void {
  runInTransaction(() => {
    rememberTranscript(id, 'Previous transcription')
    for (const speaker of checkpoint.speakers) run(`INSERT INTO speakers(id, recording_id, label, voice_profile_id, embedding, suggested_profile_id, match_score) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET embedding=excluded.embedding,
      label=CASE WHEN speakers.label_source='manual' THEN speakers.label ELSE excluded.label END,
      voice_profile_id=CASE WHEN speakers.label_source='manual' THEN speakers.voice_profile_id ELSE excluded.voice_profile_id END,
      suggested_profile_id=CASE WHEN speakers.label_source='manual' THEN NULL ELSE excluded.suggested_profile_id END,
      match_score=CASE WHEN speakers.label_source='manual' THEN speakers.match_score ELSE excluded.match_score END`, [speaker.id, id, speaker.label, speaker.profileId, speaker.embedding ? embeddingBytes(speaker.embedding) : null, speaker.suggestedId, speaker.score])
    run('DELETE FROM segments WHERE recording_id=?', [id])
    for (const segment of checkpoint.segments) run('INSERT INTO segments(id, recording_id, start, end, text, speaker_id) VALUES (?, ?, ?, ?, ?, ?)', [segment.id, id, segment.start, segment.end, segment.text, segment.speakerId])
    run("DELETE FROM speakers WHERE recording_id=? AND label_source<>'manual' AND NOT EXISTS(SELECT 1 FROM segments t WHERE t.speaker_id=speakers.id) AND NOT EXISTS(SELECT 1 FROM voice_samples v WHERE v.speaker_id=speakers.id)", [id])
    run('INSERT INTO recording_overviews(recording_id,speaker_limited) VALUES (?,?) ON CONFLICT(recording_id) DO UPDATE SET speaker_limited=excluded.speaker_limited', [id, Number(!!checkpoint.speakerLimitReached)])
    const named = checkpoint.segments.map(segment => ({ ...segment, speakerName: segment.speakerId ? queryOne<{ label: string }>('SELECT label FROM speakers WHERE id=?', [segment.speakerId])?.label ?? segment.speakerName : segment.speakerName }))
    run('INSERT INTO transcripts(id, recording_id, text, language, provider, model) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(recording_id) DO UPDATE SET text=excluded.text, language=excluded.language, provider=excluded.provider, model=excluded.model', [randomUUID(), id, transcriptContent(named), settings.language, settings.transcription.provider, settings.transcription.model])
    run('UPDATE recordings SET duration_seconds=?, duration_source=? WHERE id=?', [checkpoint.duration, 'file', id])
    rememberTranscript(id, 'Transcription')
  })
}
export function savedTranscript(id: string): TranscriptCheckpoint {
  const detail = getDetail(id)
  const speakers = queryAll<{ id: string; label: string; voice_profile_id: string | null; suggested_profile_id: string | null; match_score: number | null; embedding: Buffer | null }>('SELECT s.* FROM speakers s WHERE s.recording_id=? AND EXISTS(SELECT 1 FROM segments t WHERE t.speaker_id=s.id)', [id])
  return { segments: detail.segments, duration: detail.recording.duration ?? 0, speakerLimitReached: detail.speakerLimitReached, speakers: speakers.map(speaker => ({ id: speaker.id, label: speaker.label, profileId: speaker.voice_profile_id, suggestedId: speaker.suggested_profile_id, score: speaker.match_score, embedding: speaker.embedding ? Array.from({ length: speaker.embedding.length / 4 }, (_, index) => speaker.embedding!.readFloatLE(index * 4)) : null })) }
}
export function saveProcessingResult(id: string, result: ProcessingResult, settings: AISettings): void {
  runInTransaction(() => {
    if (!result.empty && result.transcriptChanged !== false) saveTranscript(id, result, settings)
    if (result.summary) {
      run('INSERT INTO recording_overviews(recording_id,summary_version) VALUES (?,?) ON CONFLICT(recording_id) DO UPDATE SET summary_version=excluded.summary_version', [id, transcriptVersion(id)])
      const recording = queryOne<Recording & { title_source: string | null }>('SELECT * FROM recordings WHERE id=?', [id])
      if (recording && (!recording.title || recording.title_source === 'ai')) run("UPDATE recordings SET title=?, title_source='ai' WHERE id=?", [result.summary.title, id])
      run('INSERT INTO summaries(id, recording_id, text, template) VALUES (?, ?, ?, ?) ON CONFLICT(recording_id) DO UPDATE SET text=excluded.text, template=excluded.template', [randomUUID(), id, result.summary.summary, settings.summaryTemplate])
      if (result.summary.meetingType && result.summary.participants) run('INSERT INTO recording_overviews(recording_id,meeting_type,participants) VALUES (?,?,?) ON CONFLICT(recording_id) DO UPDATE SET meeting_type=excluded.meeting_type,participants=excluded.participants', [id, result.summary.meetingType, JSON.stringify(result.summary.participants)])
      if (result.summary.tags) {
        run("DELETE FROM recording_tags WHERE recording_id=? AND source='ai'", [id])
        const manual = queryAll<{ tag: string }>('SELECT tag FROM recording_tags WHERE recording_id=?', [id])
        const existingTags = new Set(manual.map(item => item.tag.toLowerCase()))
        for (const tag of result.summary.tags.filter(tag => !existingTags.has(tag.toLowerCase())).slice(0, Math.max(0, 20 - manual.length))) run("INSERT INTO recording_tags(recording_id,tag,source) VALUES (?,?,'ai') ON CONFLICT(recording_id,tag) DO NOTHING", [id, tag])
      }
      const previous = queryAll<{ id: string; text: string; done: number; due_date: string | null }>('SELECT id, text, done, due_date FROM actionables WHERE recording_id=?', [id])
      const retained = new Set<string>()
      const createdAt = new Date().toISOString()
      for (const item of result.summary.actionItems) {
        const existing = previous.find(value => !retained.has(value.id) && value.text.trim().toLocaleLowerCase() === item.text.trim().toLocaleLowerCase())
        if (existing) {
          retained.add(existing.id)
          // Regenerating a summary must not undo completion or edited deadlines.
          run('UPDATE actionables SET start=?,owner=? WHERE id=?', [item.start, item.owner ?? null, existing.id])
        } else run('INSERT INTO actionables(id, recording_id, text, start, created_at, due_date, owner) VALUES (?, ?, ?, ?, ?, ?, ?)', [randomUUID(), id, item.text, item.start, createdAt, item.dueDate ?? null, item.owner ?? null])
      }
      for (const item of previous) if (!retained.has(item.id) && !item.done && item.due_date === null) run('DELETE FROM actionables WHERE id=?', [item.id])
    }
    const stage = result.empty ? 'empty' : 'done'
    run('UPDATE recordings SET status=? WHERE id=?', [stage, id])
    run('UPDATE transcription_jobs SET stage=?, progress=1, error=NULL, next_attempt_at=NULL, summary_pending=?, message=? WHERE recording_id=?', [stage, Number(!result.empty && !result.summary), result.empty ? 'Skipped: silence or no usable audio was detected locally.' : result.summary ? 'Transcript, summary and action items are ready.' : 'Local transcript is ready. Connect a summary provider in Settings to add a summary and action items.', id])
  })
}
