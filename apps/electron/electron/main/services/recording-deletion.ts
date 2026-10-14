import { lstat, readdir, rm, unlink } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import type { RecordingDeletionInfo } from '../../../src/shared/recording-deletion'
import type { PipelineState } from '../types/device-pipeline'
import { queryOne, run, runInTransaction, type Recording } from './database'

interface DeletionDependencies {
  dataPath: string
  device: { getState(): PipelineState; deleteFile(filename: string): Promise<{ result: string } | null> }
  pause<T>(id: string, action: () => Promise<T>): Promise<T>
  waitPlayback(id: string): Promise<void>
  dismissDownload(filename: string): void
  changed(): void
}
type DeletableRecording = Recording & { device_serial: string | null }
function missing(error: unknown): boolean { return !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT' }

/** Coordinates explicit deletion: device acknowledgement precedes any local removal. */
export class RecordingDeletionService {
  private readonly deleting = new Set<string>()
  private readonly tasks = new Set<Promise<void>>()
  constructor(private readonly dependencies: DeletionDependencies) {}
  /** Waits for acknowledged local cleanup before the application closes SQLite. */
  async drain(): Promise<void> { await Promise.allSettled([...this.tasks]) }
  info(id: string): RecordingDeletionInfo {
    const row = queryOne<DeletableRecording>('SELECT * FROM recordings WHERE id=?', [id])
    if (!row) throw new Error('Recording was not found.')
    const deviceRequired = !!row.device_serial || !!queryOne('SELECT original_filename FROM synced_files WHERE original_filename=?', [row.filename])
    const deviceDone = queryOne<{ device_done: number }>('SELECT device_done FROM recording_deletions WHERE recording_id=?', [id])?.device_done === 1
    const state = this.dependencies.device.getState()
    let reason: string | null = null
    if (deviceRequired && !deviceDone) {
      if (!row.verified || !row.file_path || !row.checksum) reason = 'Download and verify a local copy before deleting this recording from the recorder.'
      else if (!row.device_serial || state.device?.serialNumber !== row.device_serial || state.phase === 'disconnected') reason = 'Connect the original recorder to delete this recording everywhere. Your local copy will be kept until the recorder confirms deletion.'
      else if (state.phase === 'error') reason = state.error ?? 'Reconnect the recorder before deleting this recording.'
      else if (state.phase !== 'idle') reason = `Wait for the recorder to finish its current operation (${state.phase}). This dialog updates automatically when it is ready.`
    }
    return { deviceRequired, deviceDone, allowed: !reason, reason }
  }
  delete(id: string, confirmed: boolean): Promise<void> {
    const task = this.performDelete(id, confirmed)
    this.tasks.add(task)
    void task.then(() => this.tasks.delete(task), () => this.tasks.delete(task))
    return task
  }
  private async performDelete(id: string, confirmed: boolean): Promise<void> {
    if (confirmed !== true) throw new Error('Confirm before deleting this recording.')
    if (this.deleting.has(id)) throw new Error('This recording is already being deleted.')
    const info = this.info(id)
    if (!info.allowed) throw new Error(info.reason!)
    const row = queryOne<DeletableRecording>('SELECT * FROM recordings WHERE id=?', [id])!
    this.deleting.add(id)
    run('INSERT OR IGNORE INTO recording_deletions(recording_id,device_done,created_at) VALUES (?,?,?)', [id, Number(info.deviceDone || !info.deviceRequired), new Date().toISOString()])
    try {
      await this.dependencies.pause(id, async () => {
        if (row.file_path && queryOne('SELECT id FROM recordings WHERE file_path=? AND id<>?', [row.file_path, id])) throw new Error('Another recording shares this audio file. Resolve that duplicate before deleting it.')
        if (info.deviceRequired && !info.deviceDone) {
          const latest = this.info(id)
          if (!latest.allowed) throw new Error(latest.reason!)
          const result = await this.dependencies.device.deleteFile(row.filename)
          if (result?.result !== 'success') throw new Error('The recorder did not confirm deletion. Your local audio and notes have been kept.')
          run('UPDATE recording_deletions SET device_done=1 WHERE recording_id=?', [id])
        }
        await this.dependencies.waitPlayback(id)
        if (row.file_path) {
          try {
            const file = await lstat(row.file_path)
            if (!file.isFile() || file.isSymbolicLink()) throw new Error('The recording path is not an ordinary audio file. Local removal stopped.')
            await unlink(row.file_path)
          } catch (error) { if (!missing(error)) throw error }
        }
        for (const kind of ['analysis', 'transcription']) {
          const root = resolve(this.dependencies.dataPath, 'cache', kind), target = resolve(root, id)
          if (!target.startsWith(root + sep)) throw new Error('Invalid recording cache path.')
          try { if ((await lstat(target)).isSymbolicLink()) throw new Error('A recording cache points outside app storage. Local removal stopped.'); await rm(target, { recursive: true, force: true }) } catch (error) { if (!missing(error)) throw error }
        }
        const playback = join(this.dependencies.dataPath, 'cache', 'playback')
        try { for (const name of await readdir(playback)) if (name.startsWith(id + '-')) await unlink(join(playback, name)) } catch (error) { if (!missing(error)) throw error }
        runInTransaction(() => {
          run('DELETE FROM voice_samples WHERE source_recording=? OR speaker_id IN (SELECT id FROM speakers WHERE recording_id=?)', [id, id])
          run('INSERT OR IGNORE INTO purge_tombstones(filename) VALUES (?)', [row.filename])
          run('DELETE FROM synced_files WHERE original_filename=?', [row.filename])
          run('DELETE FROM device_file_cache WHERE filename=?', [row.filename])
          run('DELETE FROM download_queue WHERE filename=?', [row.filename])
          run('DELETE FROM recordings WHERE id=?', [id])
        })
        this.dependencies.dismissDownload(row.filename)
        this.dependencies.changed()
      })
    } catch (error) {
      const done = queryOne<{ device_done: number }>('SELECT device_done FROM recording_deletions WHERE recording_id=?', [id])?.device_done
      if (!done) run('DELETE FROM recording_deletions WHERE recording_id=?', [id])
      else {
        run("UPDATE transcription_jobs SET stage='failed',error='Deletion needs to be retried to finish removing local files.',message='Deletion incomplete. Use Delete recording again.' WHERE recording_id=?", [id])
        run("UPDATE recordings SET status='failed' WHERE id=?", [id])
      }
      this.dependencies.changed()
      throw error
    } finally { this.deleting.delete(id) }
  }
}
