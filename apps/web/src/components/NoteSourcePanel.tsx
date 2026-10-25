import { useEffect, useState } from 'react'
import { FileText, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { WrittenNoteCitation } from '../shared/ai'
import { appClient } from '../services/app-client'
import { noteUrl } from '../services/note-url'
import { Button } from './ui'

export function NoteSourcePanel({ citation, onClose }: { citation: WrittenNoteCitation; onClose(): void }): JSX.Element {
  const [availability, setAvailability] = useState<'loading' | 'available' | 'unavailable'>('loading')
  const [changed, setChanged] = useState(false)
  useEffect(() => {
    let current = true
    void appClient.notes.get(citation.noteId, citation.revision).then(async () => { if (current) setAvailability('available'); try { const latest = await appClient.notes.get(citation.noteId); if (current) setChanged(latest.revision !== citation.revision) } catch { if (current) setChanged(true) } }).catch(() => { if (current) setAvailability('unavailable') })
    return () => { current = false }
  }, [citation.noteId, citation.revision])
  return <aside className="assistant-source-panel" aria-label="Written note source"><header className="source-panel-heading"><div><small>Written source [{citation.number}] · Revision {citation.revision}</small><h2>{citation.title}</h2></div><Button variant="ghost" aria-label="Close source panel" onClick={onClose}><X size={18} /></Button></header><div className="source-panel-scroll"><p className="muted">{citation.projectName ?? 'Unfiled items'}{citation.heading ? ` · ${citation.heading}` : ''}</p><section className="source-cited-passage" aria-label="Cited passage"><small><FileText size={14} />Written note · Cited passage</small><p>{citation.excerpt}</p></section>{availability === 'unavailable' ? <p role="status">This saved revision is no longer available. The passage above is the exact excerpt used in this answer.</p> : availability === 'loading' ? <p role="status">Checking saved revision…</p> : <>{changed && <p role="status">This note has changed since the answer. Open the cited revision to review the original passage.</p>}<Link className="button button-secondary" to={noteUrl(citation.noteId, citation.projectId, citation.revision, citation.blockId)}>Open note</Link></>}<p className="source-recorded-at">Written sources describe what the note says. They do not provide an audio timestamp.</p></div></aside>
}
