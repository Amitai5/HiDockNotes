import { appClient } from '../services/app-client'
import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useState } from 'react'
import { Trash2, X } from 'lucide-react'
import type { RecordingView } from '../shared/contracts'
import type { RecordingDeletionInfo } from '../shared/recording-deletion'
import { Button } from './ui'

export function RecordingDelete({ recording, open, onOpenChange, onClosed, onDeleting, onDeleted }: { recording: RecordingView; open: boolean; onOpenChange(open: boolean): void; onClosed(): void; onDeleting?(value: boolean): void; onDeleted?(): void }): JSX.Element {
  const [info, setInfo] = useState<RecordingDeletionInfo | null>(null), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    let active = true
    setInfo(null); setError(null)
    let revision = 0
    const load = (): void => {
      const current = ++revision
      void appClient.library.deletionInfo(recording.id).then(value => { if (active && current === revision) setInfo(value) }).catch(value => { if (active && current === revision) setError(value instanceof Error ? value.message : 'Deletion details could not be loaded.') })
    }
    load()
    const unsubscribe = appClient.devicePipeline.onState(load)
    return () => { active = false; unsubscribe() }
  }, [open, recording.id])
  async function remove(): Promise<void> {
    setBusy(true); setError(null); onDeleting?.(true)
    try { await appClient.library.delete(recording.id, true); onOpenChange(false); onDeleted?.() }
    catch (value) { setError(value instanceof Error ? value.message : 'Deletion could not be completed.'); onDeleting?.(false) }
    finally { setBusy(false) }
  }
  return <Dialog.Root open={open} onOpenChange={value => { if (!busy) onOpenChange(value) }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="confirmation-dialog delete-dialog" onEscapeKeyDown={event => { if (busy) event.preventDefault() }} onInteractOutside={event => { if (busy) event.preventDefault() }} onCloseAutoFocus={event => { event.preventDefault(); onClosed() }}>
    <div className="folder-dialog-heading"><span className="folder-dialog-icon danger-text"><Trash2 size={21} /></span><Dialog.Title>Delete recording?</Dialog.Title><Dialog.Close asChild><Button variant="ghost" aria-label="Close delete dialog" disabled={busy}><X size={17} /></Button></Dialog.Close></div>
    <Dialog.Description><strong>{recording.title || recording.filename}</strong>{info?.deviceRequired ? ' will be removed from the server. Recorder cleanup will run when you reconnect the original device.' : ' will be removed from the server.'} Its audio, transcript, summary, action items, tags, cached files and voice samples from this recording will be deleted. This cannot be undone.</Dialog.Description>
    {info?.deviceDone && info.deviceRequired && <p>The recorder has already confirmed deletion. Retry will finish removing the local files and notes.</p>}
    {info?.reason && <p role="status" className="danger-text">{info.reason}</p>}
    {error && <p role="alert" className="danger-text">{error}</p>}
    <div className="dialog-actions"><Button disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="danger" disabled={!info?.allowed} busy={busy} onClick={() => { void remove() }}>{busy ? 'Deleting…' : 'Delete recording'}</Button></div>
  </Dialog.Content></Dialog.Portal></Dialog.Root>
}
