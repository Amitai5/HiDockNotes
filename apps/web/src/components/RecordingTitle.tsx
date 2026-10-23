import { appClient } from '../services/app-client'
import { useState } from 'react'
import { Check, Pencil, X } from 'lucide-react'
import { Button } from './ui'
import { reportError } from '../store/useAppStore'

export function RecordingTitle({ id, title, onSaved }: { id: string; title: string; onSaved(): void }): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const [busy, setBusy] = useState(false)
  async function save(): Promise<void> {
    if (!draft.trim()) return
    setBusy(true)
    try { await appClient.library.rename(id, draft.trim()); setEditing(false); onSaved() } catch (error) { reportError(error) } finally { setBusy(false) }
  }
  if (editing) return <form className="recording-title-form" onSubmit={event => { event.preventDefault(); void save() }} onKeyDown={event => { if (event.key === 'Escape' && !busy) setEditing(false) }}>
    <input autoFocus aria-label="Recording title" maxLength={200} value={draft} disabled={busy} onChange={event => setDraft(event.target.value)} />
    <Button type="submit" variant="primary" busy={busy} disabled={!draft.trim()}><Check size={15} />Save</Button>
    <Button type="button" disabled={busy} aria-label="Cancel renaming" onClick={() => setEditing(false)}><X size={15} /></Button>
  </form>
  return <div className="recording-title"><h1>{title}</h1><Button variant="ghost" aria-label="Rename recording" title="Rename recording" onClick={() => { setDraft(title); setEditing(true) }}><Pencil size={16} /></Button></div>
}
