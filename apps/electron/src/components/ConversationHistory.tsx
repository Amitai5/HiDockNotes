import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useState } from 'react'
import { History, MessageSquare, Pencil, Search, Trash2, X } from 'lucide-react'
import type { ConversationDetail, ConversationView } from '../shared/conversations'
import { Button } from './ui'

export function ConversationHistory({ selected, onSelect, onSaved, onDeleted }: { selected: string | null; onSelect(id: string): void; onSaved(detail: ConversationDetail): void; onDeleted(id: string): void }): JSX.Element {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [items, setItems] = useState<ConversationView[]>([])
  const [target, setTarget] = useState<ConversationView | null>(null), [mode, setMode] = useState<'list' | 'rename' | 'delete'>('list')
  const [title, setTitle] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [revision, setRevision] = useState(0)
  useEffect(() => window.electronAPI.conversations.onChanged(() => setRevision(value => value + 1)), [])
  useEffect(() => {
    if (!open) return
    let active = true
    const timer = setTimeout(() => { setLoading(true); void window.electronAPI.conversations.list(query).then(value => { if (active) { setItems(value); setError('') } }).catch(value => { if (active) setError(value instanceof Error ? value.message : 'Chats could not be loaded.') }).finally(() => { if (active) setLoading(false) }) }, query ? 150 : 0)
    return () => { active = false; clearTimeout(timer) }
  }, [query, open, revision])
  async function save(): Promise<void> {
    if (!target) return
    setBusy(true); setError('')
    try {
      if (mode === 'rename') onSaved(await window.electronAPI.conversations.rename(target.id, title.trim(), target.version))
      else { await window.electronAPI.conversations.delete(target.id, true); onDeleted(target.id) }
      setMode('list'); setTarget(null); setRevision(value => value + 1)
    } catch (value) { setError(value instanceof Error ? value.message : 'The chat could not be changed.') } finally { setBusy(false) }
  }
  return <Dialog.Root open={open} onOpenChange={value => { if (!busy) { setOpen(value); setMode('list'); setError('') } }}>
    <Dialog.Trigger asChild><Button aria-label="Chat history"><History size={17} /></Button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="confirmation-dialog chat-history-dialog">
      <div className="panel-heading"><Dialog.Title>{mode === 'rename' ? 'Rename chat' : mode === 'delete' ? 'Delete chat?' : 'Saved chats'}</Dialog.Title><Dialog.Close asChild><Button variant="ghost" disabled={busy} aria-label="Close chat history"><X size={17} /></Button></Dialog.Close></div>
      <Dialog.Description className={mode === 'list' ? 'sr-only' : ''}>{mode === 'list' ? 'Find and reopen an Assistant conversation.' : mode === 'delete' ? 'This deletes the saved conversation and its messages. Recordings stay in your library.' : 'Choose a name for this conversation.'}</Dialog.Description>
      {mode === 'list' ? <><div className="input-with-icon"><Search size={16} /><input autoFocus aria-label="Search saved chats" placeholder="Search chats…" value={query} onChange={event => setQuery(event.target.value)} maxLength={500} /></div><div className="chat-history-list" aria-busy={loading}>
        {items.map(item => <div className={`chat-history-row ${selected === item.id ? 'selected' : ''}`} key={item.id}><button className="chat-history-open" aria-label={`Open chat: ${item.title}`} onClick={() => { onSelect(item.id); setOpen(false) }}><MessageSquare size={17} /><span><strong>{item.title}</strong><small>{item.projectName ?? 'All projects'} · {new Date(item.updatedAt).toLocaleDateString()}{item.responding ? ' · Answering…' : ''}</small></span></button><Button variant="ghost" disabled={item.responding} aria-label={`Rename ${item.title}`} onClick={() => { setTarget(item); setTitle(item.title); setMode('rename'); setError('') }}><Pencil size={15} /></Button><Button variant="ghost" disabled={item.responding} aria-label={`Delete ${item.title}`} onClick={() => { setTarget(item); setMode('delete'); setError('') }}><Trash2 size={15} /></Button></div>)}
        {!items.length && <p className="muted">{loading ? 'Loading chats…' : query ? 'No matching chats.' : 'Your conversations will appear here.'}</p>}
      </div></> : <form onSubmit={event => { event.preventDefault(); void save() }}>{mode === 'rename' && <label className="chat-rename-label">Chat name<input autoFocus aria-label="Chat name" maxLength={120} value={title} onChange={event => setTitle(event.target.value)} /></label>}<div className="dialog-actions"><Button type="button" disabled={busy} onClick={() => { setMode('list'); setError('') }}>Cancel</Button><Button type="submit" variant={mode === 'delete' ? 'danger' : 'primary'} disabled={mode === 'rename' && !title.trim()} busy={busy}>{mode === 'delete' ? 'Delete chat' : 'Save name'}</Button></div></form>}
      {error && <p role="alert" className="danger-text">{error}</p>}
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>
}
