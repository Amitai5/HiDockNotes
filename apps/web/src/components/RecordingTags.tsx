import { appClient } from '../services/app-client'
import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { reportError } from '../store/useAppStore'

export function RecordingTags({ id, tags, onSaved }: { id: string; tags: string[]; onSaved(): void }): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  async function save(next: string[]): Promise<void> {
    setBusy(true)
    try { await appClient.library.setTags(id, next); setDraft(''); setEditing(false); onSaved() } catch (error) { reportError(error) } finally { setBusy(false) }
  }
  return <div className="recording-tags">{tags.map(tag => <span className="metadata-tag" key={tag}>{tag}<button disabled={busy} aria-label={`Remove tag ${tag}`} onClick={() => { void save(tags.filter(value => value !== tag)) }}><X size={11} /></button></span>)}
    {editing ? <form className="tag-form" onSubmit={event => { event.preventDefault(); if (draft.trim()) void save([...tags, draft.trim()]) }}><input autoFocus aria-label="New tag" placeholder="Tag name" value={draft} disabled={busy} maxLength={40} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { setEditing(false); setDraft('') } }} /><button type="submit" aria-label="Save tag" disabled={busy || !draft.trim()}><Plus size={13} /></button><button type="button" aria-label="Cancel tag" disabled={busy} onClick={() => { setEditing(false); setDraft('') }}><X size={12} /></button></form> : tags.length < 20 && <button className="add-tag" onClick={() => setEditing(true)} disabled={busy}><Plus size={12} />Add tag</button>}
  </div>
}
