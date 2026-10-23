import { appClient } from '../services/app-client'
import * as Dialog from '@radix-ui/react-dialog'
import { useId, useRef, useState } from 'react'
import { FolderPlus, X } from 'lucide-react'
import { Button } from './ui'

export function CreateProjectFolder(): JSX.Element {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const nameId = useId()
  const nameInput = useRef<HTMLInputElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  async function create(): Promise<void> {
    if (!name.trim() || busy) return
    setBusy(true); setError('')
    try { await appClient.projects.create(name.trim()); setOpen(false); setName('') }
    catch (value) { setError(value instanceof Error ? value.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'The folder could not be created.') }
    finally { setBusy(false) }
  }
  return <Dialog.Root open={open} onOpenChange={value => { if (!busy) { setOpen(value); setError('') } }}>
    <Dialog.Trigger asChild><Button ref={trigger}><FolderPlus size={16} />New folder</Button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="dialog-overlay folder-dialog-overlay" /><Dialog.Content className="confirmation-dialog folder-dialog" onOpenAutoFocus={event => { event.preventDefault(); nameInput.current?.focus() }} onCloseAutoFocus={event => { event.preventDefault(); requestAnimationFrame(() => trigger.current?.focus()) }}>
      <div className="panel-heading"><div className="folder-dialog-title"><span className="folder-dialog-icon"><FolderPlus size={20} /></span><Dialog.Title>New folder</Dialog.Title></div><Dialog.Close asChild><Button variant="ghost" aria-label="Close new folder" disabled={busy}><X size={18} /></Button></Dialog.Close></div>
      <Dialog.Description>Give related recordings a place in your Library. Add recordings by dragging them onto the folder.</Dialog.Description>
      <form onSubmit={event => { event.preventDefault(); void create() }}><label htmlFor={nameId}>Folder name</label><input ref={nameInput} id={nameId} placeholder="e.g. Product interviews" maxLength={80} value={name} onChange={event => setName(event.target.value)} disabled={busy} aria-invalid={!!error} aria-describedby={error ? `${nameId}-error` : undefined} />{error && <p className="provider-error" id={`${nameId}-error`} role="alert">{error}</p>}<div className="dialog-actions"><Dialog.Close asChild><Button type="button" disabled={busy}>Cancel</Button></Dialog.Close><Button type="submit" variant="primary" busy={busy} disabled={!name.trim()}>Create folder</Button></div></form>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>
}
