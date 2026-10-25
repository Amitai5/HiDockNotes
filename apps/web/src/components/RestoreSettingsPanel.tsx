import { appClient } from '../services/app-client'
import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useState } from 'react'
import { ArchiveRestore, CheckCircle2, LoaderCircle, X } from 'lucide-react'
import { EMPTY_RESTORE_STATE, type RestoreState } from '../shared/restore'
import { Button, formatBytes } from './ui'
import { reportError } from '../store/useAppStore'

export function RestoreSettingsPanel({ backupBusy }: { backupBusy: boolean }): JSX.Element | null {
  const api = appClient.restore
  const [state, setState] = useState<RestoreState>(EMPTY_RESTORE_STATE)
  const [choosing, setChoosing] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [restarting, setRestarting] = useState(false)
  useEffect(() => {
    if (!api) return
    let mounted = true, updated = false
    const stop = api.onState(value => { updated = true; if (mounted) { setState(value); setConfirmed(false) } })
    void api.state().then(value => { if (mounted && !updated) setState(value) }).catch(reportError)
    return () => { mounted = false; stop() }
  }, [api])
  if (!api) return null
  const active = choosing || state.phase === 'verifying' || restarting
  const preview = state.preview
  return <div className="restore-settings">
    <div className="backup-card"><div className="backup-description"><ArchiveRestore size={24} /><div><strong>Restore a library</strong><p>Preview before restoring.</p></div></div><Button disabled={backupBusy || active} onClick={() => { setChoosing(true); void api.choose().catch(reportError).finally(() => setChoosing(false)) }}>{active ? <LoaderCircle className="animate-spin" size={16} /> : <ArchiveRestore size={16} />}{state.phase === 'verifying' ? 'Verifying backup…' : restarting ? 'Saving library and restarting…' : 'Choose backup'}</Button>
      {state.phase === 'verifying' && <div className="backup-progress" role="status"><p>Checking archive paths, audio checksums and library integrity… {formatBytes(state.completedBytes)} verified.</p><Button variant="ghost" onClick={() => { void api.cancel().catch(reportError) }}>Cancel verification</Button></div>}
      {state.phase === 'failed' && <p className="danger" role="alert">{state.error}</p>}
    </div>
    <Dialog.Root open={state.phase === 'ready' || restarting} onOpenChange={open => { if (!open && !restarting) void api.cancel().catch(reportError) }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="confirmation-dialog restore-dialog" onEscapeKeyDown={event => { if (restarting) event.preventDefault() }} onInteractOutside={event => { if (restarting) event.preventDefault() }}>
      <div className="panel-heading"><Dialog.Title><ArchiveRestore size={21} />Restore this library?</Dialog.Title><Dialog.Close asChild><Button variant="ghost" aria-label="Close restore preview" disabled={restarting}><X size={18} /></Button></Dialog.Close></div>
      <Dialog.Description>Saves your current library, replaces it with this backup, then restarts.</Dialog.Description>
      {preview && <><div className="restore-archive-info"><CheckCircle2 size={18} /><div><strong>{preview.fileName}</strong><span>Verified · {new Date(preview.createdAt).toLocaleString()} · v{preview.appVersion} · {formatBytes(preview.bytes)}</span></div></div>
        <div className="restore-counts">{[['Recordings', preview.counts.recordings ?? 0], ['Written notes', preview.counts.written_notes ?? 0], ['Note revisions', preview.counts.written_note_versions ?? 0], ['Note tags', preview.counts.written_note_tags ?? 0], ['Audio files', preview.localRecordings], ['Projects', preview.counts.projects ?? 0], ['Action items', preview.counts.actionables ?? 0], ['Remembered voices', preview.counts.voice_profiles ?? 0], ['Tags', preview.counts.recording_tags ?? 0], ['Saved chats', preview.counts.assistant_conversations ?? 0], ['Chat messages', preview.counts.assistant_messages ?? 0], ['Calendars', preview.counts.calendar_sources ?? 0]].map(([label, count]) => <div key={label}><strong>{count}</strong><span>{label}</span></div>)}</div>
        {preview.deviceOnly > 0 && <p className="muted">{preview.deviceOnly} recording{preview.deviceOnly === 1 ? '' : 's'} had no local audio in this backup. Reconnect the original recorder to download them.</p>}
        {preview.changedAudio > 0 && <p className="danger">{preview.changedAudio} audio file{preview.changedAudio === 1 ? '' : 's'} differed from their original verification checksum when backed up. They will be restored as unverified.</p>}
        <p className="muted">Reconnect AI accounts and agents after restoring. Automatic processing stays paused for review.</p>
        <label className="restore-confirm"><input type="checkbox" checked={confirmed} disabled={restarting} onChange={event => setConfirmed(event.target.checked)} /><span>Replace the library on your server with this verified backup.</span></label>
      </>}
      <div className="dialog-actions"><Button disabled={restarting} onClick={() => { void api.cancel().catch(reportError) }}>Cancel</Button><Button variant="primary" disabled={!confirmed || !preview} busy={restarting} onClick={() => { if (!preview) return; setRestarting(true); void api.confirm(preview.id, true).then(started => { if (!started) setRestarting(false) }).catch(error => { setRestarting(false); reportError(error) }) }}>Save current library and restore</Button></div>
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </div>
}
