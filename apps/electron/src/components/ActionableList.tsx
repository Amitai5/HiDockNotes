import { useState } from 'react'
import { ArrowUpRight, Pencil } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { ActionableView } from '../shared/contracts'
import { Button, formatDuration } from './ui'
import { reportError } from '../store/useAppStore'

export function ActionableList({ items, onChanged, emptyText }: { items: ActionableView[]; onChanged(): void; emptyText?: string }): JSX.Element {
  const [editing, setEditing] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  async function update(id: string, patch: { text?: string; done?: boolean }): Promise<void> {
    setBusy(true)
    try { await window.electronAPI.actionables.update(id, patch); setEditing(null); onChanged() } catch (error) { reportError(error) } finally { setBusy(false) }
  }
  if (!items.length) return <p className="muted">{emptyText ?? 'No action items yet.'}</p>
  return <div className="actionable-list">{items.map(item => <div className="actionable-row" key={item.id}>
    <input type="checkbox" disabled={busy} aria-label={`Complete ${item.text}`} checked={item.done} onChange={event => { void update(item.id, { done: event.target.checked }) }} />
    {editing === item.id ? <form onSubmit={event => { event.preventDefault(); void update(item.id, { text: text.trim() }) }}><input autoFocus aria-label="Action item text" value={text} maxLength={2000} onChange={event => setText(event.target.value)} /><Button type="submit" disabled={!text.trim() || busy}>Save</Button><Button type="button" disabled={busy} onClick={() => setEditing(null)}>Cancel</Button></form> : <><span className={item.done ? 'completed-text' : ''}>{item.text}</span><Button variant="ghost" aria-label="Edit action item" disabled={busy} onClick={() => { setText(item.text); setEditing(item.id) }}><Pencil size={14} /></Button></>}
    <Link className="action-source" to={`/library/${item.recordingId}${item.start !== null ? `?t=${item.start}` : ''}`} aria-label="Open source moment">{item.start !== null && <small>{formatDuration(item.start)}</small>}<ArrowUpRight size={17} /></Link>
  </div>)}</div>
}
