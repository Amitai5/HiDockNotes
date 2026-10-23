import { handle } from './trusted-ipc'
import { chooseTranscriptCandidate, editTranscript, rememberTranscript, restoreTranscriptRevision, revisionSegments, transcriptReview } from '../services/transcript-revisions'
import { saveTranscript } from '../ai/processing-store'
import { run, runInTransaction } from '../services/database'
import type { TranscriptionQueue } from '../ai/queue'

export function registerTranscriptHandlers(queue: TranscriptionQueue, changed: () => void): void {
  handle('transcript:review', id => transcriptReview(id))
  handle('transcript:revision', (id, version) => revisionSegments(id, version))
  handle('transcript:edit', (id, segment, text, version) => { editTranscript(id, segment, text, version); changed(); return transcriptReview(id) })
  handle('transcript:restore', (id, target, expected) => { restoreTranscriptRevision(id, target, expected); changed(); return transcriptReview(id) })
  handle('transcript:accept', (id, choice, version) => {
    if (typeof id !== 'string') throw new Error('Invalid recording.')
    if (choice !== 'discard' && !queue.state().summaryReady) throw new Error(queue.state().summaryReason ?? 'Configure a summary provider before applying the transcript.')
    runInTransaction(() => {
      const selected = chooseTranscriptCandidate(id, choice, version)
      if (selected) {
        rememberTranscript(id, 'Before applying a new transcription')
        if (selected.replaceCorrections) run('DELETE FROM transcript_corrections WHERE recording_id=?', [id])
        saveTranscript(id, selected.checkpoint, selected.settings)
        rememberTranscript(id, 'Applied new transcription')
        run('DELETE FROM transcript_candidates WHERE recording_id=?', [id])
        queue.reprocess(id, 'summarize')
      }
    })
    changed(); return transcriptReview(id)
  })
}
