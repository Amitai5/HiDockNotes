import * as Dialog from '@radix-ui/react-dialog'
import { useState } from 'react'
import { FolderPlus, X } from 'lucide-react'
import { Button } from './ui'

export function CreateProjectFolder(): JSX.Element {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function create(): Promise<void> {
    if (!name.trim() || busy) return
    setBusy(true); setError('')
    try { await window.electronAPI.projects.create(name.trim()); setOpen(false); setName('') }
    catch (value) { setError(value instanceof Error ? value.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'The folder could not be created.') }
    finally { setBusy(false) }
  }
  return <Dialog.Root open={open} onOpenChange={value => { if (!busy) { setOpen(value); setError('') } }}>
    <Dialog.Trigger asChild><Button><FolderPlus size={16} />New folder</Button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="dialog-content folder-dialog">
      <Dialog.Title>New project folder</Dialog.Title><Dialog.Description>Group related recordings in your Library. Assign recordings from their detail view.</Dialog.Description>
      <form onSubmit={event => { event.preventDefault(); void create() }}><label>Folder name<input autoFocus aria-label="Folder name" placeholder="e.g. Product interviews" maxLength={80} value={name} onChange={event => setName(event.target.value)} disabled={busy} /></label>{error && <p className="provider-error" role="alert">{error}</p>}<div className="dialog-actions"><Dialog.Close asChild><Button type="button" disabled={busy}>Cancel</Button></Dialog.Close><Button type="submit" variant="primary" busy={busy} disabled={!name.trim()}>Create folder</Button></div></form>
      <Dialog.Close asChild><button className="dialog-close" aria-label="Close new folder" disabled={busy}><X size={18} /></button></Dialog.Close>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>
}
