import { appClient } from '../services/app-client'
import { useState } from 'react'
import { ArrowUpRight, CheckCircle2, Pencil } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { ActionableView } from '../shared/contracts'
import { Button, formatDuration } from './ui'
import { reportError } from '../store/useAppStore'
import type { ActionablePatch } from '../shared/actionables'
import { ActionableDates } from './ActionableDates'

export function ActionableList({ items, onChanged, emptyText, onSeek }: { items: ActionableView[]; onChanged(): void; emptyText?: string; onSeek?(time: number): void }): JSX.Element {
  const [editing, setEditing] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  async function update(id: string, patch: ActionablePatch): Promise<void> {
    setBusy(true)
    try { await appClient.actionables.update(id, patch); setEditing(null); setFeedback(patch.done === true ? 'Action item marked done.' : patch.done === false ? 'Action item reopened.' : 'Action item updated.'); onChanged() } catch (error) { reportError(error) } finally { setBusy(false) }
  }
  return <div className="actionable-list">{feedback && <p className="actionable-feedback" role="status">{feedback}</p>}{!items.length && <p className="muted">{emptyText ?? 'No action items yet.'}</p>}{items.map(item => <div className={`actionable-row ${item.done ? 'actionable-done' : ''}`} key={item.id}>
    <input type="checkbox" disabled={busy} aria-label={`${item.done ? 'Reopen' : 'Complete'} ${item.text}`} checked={item.done} onChange={event => { void update(item.id, { done: event.target.checked }) }} />
    <div className="actionable-body">{editing === item.id ? <form className="actionable-editor" onSubmit={event => { event.preventDefault(); void update(item.id, { text: text.trim(), dueDate: dueDate || null }) }}><label>Action item<input autoFocus aria-label="Action item text" value={text} maxLength={2000} onChange={event => setText(event.target.value)} /></label><label>Due date<input type="date" aria-label="Action item due date" value={dueDate} onChange={event => setDueDate(event.target.value)} /></label><div className="toolbar-actions"><Button type="submit" disabled={!text.trim() || busy}>Save</Button><Button type="button" disabled={busy} onClick={() => setEditing(null)}>Cancel</Button></div></form> : <><div className="actionable-text"><span className={item.done ? 'completed-text' : ''}>{item.text}</span>{item.done && <span className="actionable-done-badge"><CheckCircle2 size={12} />Done</span>}</div><small className="action-owner">Owner: {item.owner ?? 'Unassigned'}</small><ActionableDates item={item} /></>}</div>
    <Button variant="ghost" aria-label={`Edit ${item.text}`} disabled={busy} onClick={() => { setText(item.text); setDueDate(item.dueDate ?? ''); setEditing(item.id) }}><Pencil size={14} /></Button>
    {onSeek && item.start !== null ? <Button variant="ghost" className="action-source" onClick={() => onSeek(item.start!)} aria-label="Play action item moment"><small>{formatDuration(item.start)}</small><ArrowUpRight size={17} /></Button> : <Link className="action-source" to={`/library/${item.recordingId}${item.start !== null ? `?t=${item.start}` : ''}`} aria-label="Open source moment">{item.start !== null && <small>{formatDuration(item.start)}</small>}<ArrowUpRight size={17} /></Link>}
  </div>)}</div>
}
