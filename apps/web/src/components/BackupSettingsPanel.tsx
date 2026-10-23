import { appClient } from '../services/app-client'
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
    const unsubscribe = appClient.backups.onState(value => { updated = true; if (mounted) setState(value) })
    void appClient.backups.state().then(value => { if (mounted && !updated) setState(value) }).catch(reportError)
    return () => { mounted = false; unsubscribe() }
  }, [])
  const active = state.phase === 'snapshot' || state.phase === 'archiving'
  async function create(): Promise<void> {
    setChoosing(true)
    try { await appClient.backups.create() }
    catch (error) { reportError(error) }
    finally { setChoosing(false) }
  }
  return <section className="settings-section" id="backup" tabIndex={-1}>
    <h2><Archive size={18} />Library backup</h2>

    <div className="backup-card">
      <div className="backup-description"><Archive size={24} /><div><strong>Complete library backup</strong><p>All recordings and app data.</p></div></div>
      <Button variant="primary" disabled={active || choosing} onClick={() => { void create() }}>{active || choosing ? <LoaderCircle className="animate-spin" size={16} /> : <Download size={16} />}{active ? 'Creating backup…' : choosing ? 'Creating backup…' : 'Create backup'}</Button>
      {active && <div className="backup-progress" role="status"><div><span>{state.phase === 'snapshot' ? 'Saving library…' : `Archiving ${state.recordings} local recordings…`}</span><Button variant="ghost" onClick={() => { void appClient.backups.cancel().catch(reportError) }}>Cancel backup</Button></div><progress aria-label="Backup progress" max={1} value={state.progress} />{state.phase === 'archiving' && <small>{formatBytes(state.completedBytes)} of {formatBytes(state.totalBytes)}</small>}</div>}
      {state.phase === 'completed' && <div className="backup-result" role="status"><CheckCircle2 size={17} /><div><strong>Backup saved</strong><p>{state.recordings} local audio recordings and all library metadata.</p><span className="backup-path" title={state.filePath ?? undefined}>{state.filePath}</span>{state.changedAudio > 0 && <p className="danger">{state.changedAudio} saved audio file{state.changedAudio === 1 ? '' : 's'} differed from the original verification checksum. Current bytes were backed up; details are in the manifest.</p>}</div><Button onClick={() => { void appClient.backups.showFile().catch(reportError) }}><FolderOpen size={15} />Download backup</Button></div>}
      {state.phase === 'cancelled' && <p role="status" className="muted">Backup cancelled. No incomplete archive was kept.</p>}
      {state.phase === 'failed' && <p role="alert" className="danger">Backup could not be saved. {state.error}</p>}
    </div>
    <RestoreSettingsPanel backupBusy={active || choosing} />
    <details className="settings-details"><summary>Backup details</summary><p>Includes local audio, notes, saved chats and sources, calendar links, voices and settings. Keep backups private. Models, caches, incomplete downloads and device-only audio are excluded. Reconnect accounts and calendars after restoring.</p></details>
  </section>
}
