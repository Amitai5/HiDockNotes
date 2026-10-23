export interface UpdateState {
  phase: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'failed'
  currentVersion: string; nextVersion: string | null; releaseNotes: string; progress: number
  canInstall: boolean; reason: string | null; error: string | null; checkedAt: string | null
}
