export interface RestorePreview {
  id: string; fileName: string; createdAt: string; appVersion: string
  writtenNotes?: number; counts: Record<string, number>; localRecordings: number; deviceOnly: number; bytes: number; changedAudio: number
}
export interface RestoreState {
  phase: 'idle' | 'verifying' | 'ready' | 'scheduled' | 'failed'
  completedBytes: number; preview: RestorePreview | null; error: string | null
}
export const EMPTY_RESTORE_STATE: RestoreState = { phase: 'idle', completedBytes: 0, preview: null, error: null }
