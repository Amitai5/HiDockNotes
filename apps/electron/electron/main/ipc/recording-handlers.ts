import { handle } from './trusted-ipc'
import { validateBoolean, validateId } from './jensen-validation'
import type { RecordingDeletionService } from '../services/recording-deletion'
import { queryOne, run } from '../services/database'

export function registerRecordingControls(deletion: RecordingDeletionService, changed: () => void): void {
  handle('library:deletion-info', id => deletion.info(validateId(id)))
  handle('library:delete', async (id, confirmed) => deletion.delete(validateId(id), validateBoolean(confirmed)))
  handle('library:speaker-count', (value, count) => {
    const id = validateId(value)
    if (count !== null && (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > 10)) throw new Error('Choose Auto or between one and ten speakers.')
    if (!queryOne('SELECT id FROM recordings WHERE id=?', [id])) throw new Error('Recording was not found.')
    if (queryOne("SELECT recording_id FROM recording_deletions WHERE recording_id=?", [id])) throw new Error('Finish deleting this recording first.')
    if (queryOne("SELECT id FROM transcription_jobs WHERE recording_id=? AND stage NOT IN ('done','empty','failed')", [id])) throw new Error('Wait for processing to finish before changing the speaker count.')
    run('INSERT INTO recording_overviews(recording_id,expected_speakers) VALUES (?,?) ON CONFLICT(recording_id) DO UPDATE SET expected_speakers=excluded.expected_speakers', [id, count])
    changed()
  })
}
