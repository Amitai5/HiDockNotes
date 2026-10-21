import { useEffect, useState } from 'react'
import { Archive, CheckCircle2, Download, FolderOpen, LoaderCircle } from 'lucide-react'
import { EMPTY_BACKUP_STATE, type BackupState } from '../shared/backup'
import { Button, formatBytes } from './ui'
import { reportError } from '../store/useAppStore'
import { RestoreSettingsPanel } from './RestoreSettingsPanel'

export function BackupSettingsPanel(): JSX.Element {
  const [state, setState] = useState<BackupState>(EMPTY_BACKUP_STATE)
  const [choosing, setChoosing] = useState(false)
  useEffect(() => {
    let mounted = true, updated = false
    const unsubscribe = window.electronAPI.backups.onState(value => { updated = true; if (mounted) setState(value) })
    void window.electronAPI.backups.state().then(value => { if (mounted && !updated) setState(value) }).catch(reportError)
    return () => { mounted = false; unsubscribe() }
  }, [])
  const active = state.phase === 'snapshot' || state.phase === 'archiving'
  async function create(): Promise<void> {
    setChoosing(true)
    try { await window.electronAPI.backups.create() }
    catch (error) { reportError(error) }
    finally { setChoosing(false) }
  }
  return <section className="settings-section" id="backup" tabIndex={-1}>
    <h2><Archive size={18} />Library backup</h2>
    <p>Save everything in your library in one file: original audio, transcripts, summaries, projects, tags, action items and their completion history, settings, and remembered voices with all their samples.</p>
    <div className="backup-card">
      <div className="backup-description"><Archive size={24} /><div><strong>Complete library backup</strong><p>A portable .tar.gz archive, including recordings in custom storage folders.</p></div></div>
      <Button variant="primary" disabled={active || choosing} onClick={() => { void create() }}>{active || choosing ? <LoaderCircle className="animate-spin" size={16} /> : <Download size={16} />}{active ? 'Creating backup…' : choosing ? 'Choose destination…' : 'Create backup'}</Button>
      {active && <div className="backup-progress" role="status"><div><span>{state.phase === 'snapshot' ? 'Saving a consistent database snapshot…' : `Archiving ${state.recordings} local recordings…`}</span><Button variant="ghost" onClick={() => { void window.electronAPI.backups.cancel().catch(reportError) }}>Cancel backup</Button></div><progress aria-label="Backup progress" max={1} value={state.progress} />{state.phase === 'archiving' && <small>{formatBytes(state.completedBytes)} of {formatBytes(state.totalBytes)}</small>}</div>}
      {state.phase === 'completed' && <div className="backup-result" role="status"><CheckCircle2 size={17} /><div><strong>Backup saved</strong><p>{state.recordings} local audio recordings and all library metadata.</p><span className="backup-path" title={state.filePath ?? undefined}>{state.filePath}</span>{state.changedAudio > 0 && <p className="danger">{state.changedAudio} saved audio file{state.changedAudio === 1 ? '' : 's'} differed from the original verification checksum. Current bytes were backed up; details are in the manifest.</p>}</div><Button onClick={() => { void window.electronAPI.backups.showFile().catch(reportError) }}><FolderOpen size={15} />Show file</Button></div>}
      {state.phase === 'cancelled' && <p role="status" className="muted">Backup cancelled. No incomplete archive was kept.</p>}
      {state.phase === 'failed' && <p role="alert" className="danger">Backup could not be saved. {state.error}</p>}
    </div>
    <RestoreSettingsPanel backupBusy={active || choosing} />
    <p className="privacy-note">The archive contains private audio and notes; keep it somewhere you trust. API keys stay encrypted and require signing in again after a restore. Models, caches and incomplete downloads are excluded. Audio only on a disconnected recorder cannot be included.</p>
  </section>
}
