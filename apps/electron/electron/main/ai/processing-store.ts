import { randomUUID } from 'node:crypto'
import type { AISettings } from '../../../src/shared/ai'
import { queryAll, queryOne, run, runInTransaction, type Recording } from '../services/database'
import { embeddingBytes } from './voice-matching'
import { transcriptContent } from './providers'
import type { ProcessingResult, TranscriptCheckpoint } from './backend'

export function saveTranscript(id: string, checkpoint: TranscriptCheckpoint, settings: AISettings): void {
  runInTransaction(() => {
    for (const speaker of checkpoint.speakers) run(`INSERT INTO speakers(id, recording_id, label, voice_profile_id, embedding, suggested_profile_id, match_score) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET embedding=excluded.embedding,
      label=CASE WHEN speakers.label_source='manual' THEN speakers.label ELSE excluded.label END,
      voice_profile_id=CASE WHEN speakers.label_source='manual' THEN speakers.voice_profile_id ELSE excluded.voice_profile_id END,
      suggested_profile_id=CASE WHEN speakers.label_source='manual' THEN NULL ELSE excluded.suggested_profile_id END,
      match_score=CASE WHEN speakers.label_source='manual' THEN speakers.match_score ELSE excluded.match_score END`, [speaker.id, id, speaker.label, speaker.profileId, speaker.embedding ? embeddingBytes(speaker.embedding) : null, speaker.suggestedId, speaker.score])
    run('DELETE FROM segments WHERE recording_id=?', [id])
    for (const segment of checkpoint.segments) run('INSERT INTO segments(id, recording_id, start, end, text, speaker_id) VALUES (?, ?, ?, ?, ?, ?)', [segment.id, id, segment.start, segment.end, segment.text, segment.speakerId])
    const named = checkpoint.segments.map(segment => ({ ...segment, speakerName: segment.speakerId ? queryOne<{ label: string }>('SELECT label FROM speakers WHERE id=?', [segment.speakerId])?.label ?? segment.speakerName : segment.speakerName }))
    run('INSERT INTO transcripts(id, recording_id, text, language, provider, model) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(recording_id) DO UPDATE SET text=excluded.text, language=excluded.language, provider=excluded.provider, model=excluded.model', [randomUUID(), id, transcriptContent(named), settings.language, settings.transcription.provider, settings.transcription.model])
    run('UPDATE recordings SET duration_seconds=?, duration_source=? WHERE id=?', [checkpoint.duration, 'file', id])
  })
}
export function saveProcessingResult(id: string, result: ProcessingResult, settings: AISettings): void {
  runInTransaction(() => {
    if (!result.empty) saveTranscript(id, result, settings)
    if (result.summary) {
      const recording = queryOne<Recording & { title_source: string | null }>('SELECT * FROM recordings WHERE id=?', [id])
      if (recording && (!recording.title || recording.title_source === 'ai')) run("UPDATE recordings SET title=?, title_source='ai' WHERE id=?", [result.summary.title, id])
      run('INSERT INTO summaries(id, recording_id, text, template) VALUES (?, ?, ?, ?) ON CONFLICT(recording_id) DO UPDATE SET text=excluded.text, template=excluded.template', [randomUUID(), id, result.summary.summary, settings.summaryTemplate])
      const previous = queryAll<{ id: string; text: string; done: number; due_date: string | null }>('SELECT id, text, done, due_date FROM actionables WHERE recording_id=?', [id])
      const retained = new Set<string>()
      const createdAt = new Date().toISOString()
      for (const item of result.summary.actionItems) {
        const existing = previous.find(value => !retained.has(value.id) && value.text.trim().toLocaleLowerCase() === item.text.trim().toLocaleLowerCase())
        if (existing) {
          retained.add(existing.id)
          // Regenerating a summary must not undo completion or edited deadlines.
          run('UPDATE actionables SET start=? WHERE id=?', [item.start, existing.id])
        } else run('INSERT INTO actionables(id, recording_id, text, start, created_at, due_date) VALUES (?, ?, ?, ?, ?, ?)', [randomUUID(), id, item.text, item.start, createdAt, item.dueDate ?? null])
      }
      for (const item of previous) if (!retained.has(item.id) && !item.done && item.due_date === null) run('DELETE FROM actionables WHERE id=?', [item.id])
    }
    const stage = result.empty ? 'empty' : 'done'
    run('UPDATE recordings SET status=? WHERE id=?', [stage, id])
    run('UPDATE transcription_jobs SET stage=?, progress=1, error=NULL, next_attempt_at=NULL, summary_pending=?, message=? WHERE recording_id=?', [stage, Number(!result.empty && !result.summary), result.empty ? 'Skipped: silence or no usable audio was detected locally.' : result.summary ? 'Transcript, summary and action items are ready.' : 'Local transcript is ready. Connect a summary provider in Settings to add a summary and action items.', id])
  })
}
