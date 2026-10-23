export interface BackupState {
  phase: 'idle' | 'snapshot' | 'archiving' | 'completed' | 'cancelled' | 'failed'
  progress: number
  completedBytes: number
  totalBytes: number
  recordings: number
  filePath: string | null
  error: string | null
  changedAudio: number
}
export const EMPTY_BACKUP_STATE: BackupState = { phase: 'idle', progress: 0, completedBytes: 0, totalBytes: 0, recordings: 0, filePath: null, error: null, changedAudio: 0 }
export interface BackupResult { filePath: string; recordings: number; bytes: number; changedAudio: number }
