import { randomId } from '../shared/ids'
import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, FileText, X } from 'lucide-react'
import type { SourceCitation } from '../shared/ai'
import type { ProjectView } from '../shared/contracts'
import type { NoteCreate, NoteDocument, NoteSave, WrittenNote, WrittenNoteView } from '../shared/notes'
import { appClient } from '../services/app-client'
import { assistantNoteDocument, appendAssistantDocument } from '../services/assistant-note-document'
import { noteUrl } from '../services/note-url'
import { NoteDocumentView } from './NoteDocumentView'
import { Button } from './ui'

export interface AnswerNoteSnapshot { html: string; citations: SourceCitation[]; title: string; projectId: string | null }
export type AnswerNoteMode = 'create' | 'append'
type Submission = { kind: 'create'; input: NoteCreate } | { kind: 'append'; id: string; input: NoteSave }
const errorText = (error: unknown): string => error instanceof Error ? error.message : 'This answer could not be saved. Try again.'
const noteOptions = (scope: string, query: string) => ({ scope: scope === 'all' ? { kind: 'all' as const } : scope === 'unfiled' ? { kind: 'unfiled' as const } : { kind: 'project' as const, projectId: scope }, query, limit: 30 })

export default function AssistantNoteDialog({ mode, answer, projects, onClose, onClosed, onMode }: { mode: AnswerNoteMode; answer: AnswerNoteSnapshot; projects: ProjectView[]; onClose(): void; onClosed(): void; onMode(mode: AnswerNoteMode): void }): JSX.Element {
  const [title, setTitle] = useState(answer.title), [project, setProject] = useState(answer.projectId ?? '')
  const [document, setDocument] = useState<NoteDocument | null>(null), [prepareError, setPrepareError] = useState(''), [prepareAttempt, setPrepareAttempt] = useState(0)
  const [scope, setScope] = useState(answer.projectId ?? 'all'), [query, setQuery] = useState(''), [notes, setNotes] = useState<WrittenNoteView[]>([]), [cursor, setCursor] = useState<string | null>(null)
  const [listLoading, setListLoading] = useState(false), [listError, setListError] = useState(''), [listAttempt, setListAttempt] = useState(0), listRequest = useRef(0)
  const [targetId, setTargetId] = useState(''), [target, setTarget] = useState<WrittenNote | null>(null), [targetLoading, setTargetLoading] = useState(false), [targetAttempt, setTargetAttempt] = useState(0), [targetError, setTargetError] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [conflict, setConflict] = useState<WrittenNote | null>(null), [saved, setSaved] = useState<WrittenNote | null>(null)
  const saving = useRef(false), submission = useRef<Submission | null>(null)
  const locked = !!submission.current
  useEffect(() => {
    let current = true; setPrepareError('')
    void appClient.app.info().then(info => { const value = assistantNoteDocument(answer.html, answer.citations, info.origin ?? window.location.origin); if (current) setDocument(value) }).catch(value => { if (current) setPrepareError(errorText(value)) })
    return () => { current = false }
  }, [answer, prepareAttempt])
  useEffect(() => {
    if (mode !== 'append') return
    const request = ++listRequest.current; setListLoading(true); setListError(''); setNotes([]); setCursor(null)
    const timer = setTimeout(() => { void appClient.notes.list(noteOptions(scope, query)).then(page => { if (request === listRequest.current) { setNotes(page.notes); setCursor(page.nextCursor) } }).catch(value => { if (request === listRequest.current) setListError(errorText(value)) }).finally(() => { if (request === listRequest.current) setListLoading(false) }) }, 150)
    return () => { clearTimeout(timer); ++listRequest.current }
  }, [mode, scope, query, listAttempt])
  useEffect(() => {
    if (!targetId || mode !== 'append') { setTarget(null); setTargetLoading(false); setTargetError(''); setConflict(null); return }
    let current = true; setTargetLoading(true); setTargetError(''); setTarget(null); setConflict(null)
    void appClient.notes.get(targetId).then(value => { if (current) setTarget(value) }).catch(value => { if (current) setTargetError(errorText(value)) }).finally(() => { if (current) setTargetLoading(false) })
    return () => { current = false }
  }, [targetId, targetAttempt, mode])
  async function more(): Promise<void> {
    if (!cursor || listLoading) return
    const request = listRequest.current; setListLoading(true); setListError('')
    try { const page = await appClient.notes.list({ ...noteOptions(scope, query), cursor }); if (request === listRequest.current) { setNotes(current => [...current, ...page.notes.filter(note => !current.some(item => item.id === note.id))]); setCursor(page.nextCursor) } } catch (value) { if (request === listRequest.current) setListError(errorText(value)) } finally { if (request === listRequest.current) setListLoading(false) }
  }
  async function save(): Promise<void> {
    if (saving.current || saved || !document || mode === 'create' && !title.trim() || mode === 'append' && !target) return
    saving.current = true; setBusy(true); setError('')
    try {
      // Retain the exact body and ID after a lost reply; retry cannot append twice.
      if (!submission.current) submission.current = mode === 'create'
        ? { kind: 'create', input: { requestId: randomId(), projectId: project || null, title: title.trim(), document } }
        : { kind: 'append', id: target!.id, input: { title: target!.title, tags: target!.tags, document: appendAssistantDocument(target!, document), expectedRevision: target!.revision, mutationId: randomId() } }
      const request = submission.current
      if (request.kind === 'create') setSaved(await appClient.notes.create(request.input))
      else {
        const result = await appClient.notes.save(request.id, request.input)
        if (result.status === 'conflict') { submission.current = null; setTarget(result.current); setConflict(result.current); return }
        setSaved(result.note)
      }
      submission.current = null
    } catch (value) { setError(errorText(value)) } finally { saving.current = false; setBusy(false) }
  }
  function changeScope(value: string): void { setScope(value); setTargetId(''); setTarget(null); setConflict(null); setTargetError('') }
  return <Dialog.Root open onOpenChange={open => { if (!open && !saving.current) onClose() }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="confirmation-dialog assistant-note-dialog" onCloseAutoFocus={event => { event.preventDefault(); onClosed() }}>
    <div className="panel-heading"><Dialog.Title>{saved ? 'Answer saved' : mode === 'create' ? 'Save as note' : 'Append to note'}</Dialog.Title><Dialog.Close asChild><Button variant="ghost" aria-label="Close save answer" disabled={busy}><X size={18} /></Button></Dialog.Close></div>
    <Dialog.Description>{saved ? 'Your answer and its sources are saved on the server.' : mode === 'create' ? 'Create an editable note from this answer. Formatting and cited sources will be kept.' : 'Add this answer after the existing note. Its current text, title and tags will be kept.'}</Dialog.Description>
    {saved ? <div className="assistant-note-success" role="status"><CheckCircle2 size={24} /><strong>{saved.title}</strong><p>{saved.projectName ?? 'Unfiled items'} · Revision {saved.revision}</p><div className="dialog-actions"><Button onClick={onClose}>Done</Button><Link className="button button-primary" to={noteUrl(saved.id, saved.projectId)} onClick={onClose}>Open note</Link></div></div> : <>
      {prepareError ? <div className="notice" role="alert"><p>{prepareError}</p><Button onClick={() => setPrepareAttempt(value => value + 1)}>Retry preparing answer</Button></div> : !document ? <p role="status">Preparing formatted answer…</p> : null}
      {mode === 'create' ? <div className="assistant-note-fields"><label className="note-field">Note title<input aria-label="Saved note title" value={title} maxLength={300} disabled={busy || locked} onChange={event => setTitle(event.target.value)} /></label><label className="note-field">Project<select aria-label="Saved note project" value={project} disabled={busy || locked} onChange={event => setProject(event.target.value)}><option value="">Unfiled items</option>{projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div> : <>
        <div className="assistant-note-fields"><label className="note-field">Project<select aria-label="Find notes in project" value={scope} disabled={busy || locked} onChange={event => changeScope(event.target.value)}><option value="all">All projects</option><option value="unfiled">Unfiled items</option>{projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="note-field">Find a note<input type="search" aria-label="Find a note" placeholder="Search note titles or content" maxLength={500} value={query} disabled={busy || locked} onChange={event => { setQuery(event.target.value); setTargetId(''); setTarget(null); setConflict(null) }} /></label></div>
        <ul className="assistant-note-picker" aria-label="Destination notes" aria-busy={listLoading}>{notes.map(note => <li key={note.id}><button type="button" disabled={busy || locked} aria-pressed={targetId === note.id} onClick={() => { setTargetId(note.id); setConflict(null); setError('') }}><FileText size={17} /><span><strong>{note.title}</strong><small>{note.projectName ?? 'Unfiled items'} · Revision {note.revision}</small></span></button></li>)}</ul>
        {listLoading && <p role="status">Loading notes…</p>}{!listLoading && !listError && !notes.length && <p className="muted">No notes found. Choose another project or <button className="inline-link" onClick={() => onMode('create')}>save as a new note</button>.</p>}{listError && <div role="alert"><p>{listError}</p><Button onClick={() => setListAttempt(value => value + 1)}>Retry note list</Button></div>}{cursor && <Button disabled={locked} busy={listLoading} onClick={() => { void more() }}>Load more notes</Button>}
        {targetLoading && <p role="status">Loading selected note…</p>}{targetError && <div role="alert"><p>{targetError}</p><Button onClick={() => setTargetAttempt(value => value + 1)}>Reload selected note</Button></div>}{target && !conflict && <p className="muted">Append to <strong>{target.title}</strong> · saved revision {target.revision}.</p>}
      </>}
      {conflict && <div className="assistant-note-conflict" role="alert"><strong>This note changed before your answer was appended.</strong><p>Review the latest saved note below. Appending will keep revision {conflict.revision} and add your answer after it.</p><div className="assistant-note-current"><NoteDocumentView document={conflict.document} /></div></div>}
      {error && <div className="notice" role="alert"><p>{error}</p>{locked && <p>The save could not be confirmed. Retry to check its result before starting another save.</p>}</div>}
      {document && <details className="assistant-note-preview"><summary>Preview answer · {answer.citations.length} source{answer.citations.length === 1 ? '' : 's'}</summary><div><NoteDocumentView document={document} /></div></details>}
      <div className="dialog-actions"><Button disabled={busy} onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={!document || !!prepareError || mode === 'create' && !title.trim() || mode === 'append' && (!target || targetLoading)} onClick={() => { void save() }}>{error && locked ? 'Retry save' : conflict ? 'Append to latest revision' : mode === 'create' ? 'Save note' : 'Append answer'}</Button></div>
    </>}
  </Dialog.Content></Dialog.Portal></Dialog.Root>
}
