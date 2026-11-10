import { randomId } from '../shared/ids'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, FileText, Plus, Search, SlidersHorizontal, Sparkles } from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { appClient } from '../services/app-client'
import { libraryUrl, noteUrl } from '../services/note-url'
import { useLibraryContent } from '../hooks/useLibraryContent'
import { useLibraryNavigation } from '../hooks/useLibraryNavigation'
import { useSemanticSearch } from '../hooks/useSemanticSearch'
import { useAppStore } from '../store/useAppStore'
import { Button, EmptyState } from '../components/ui'
import { RecordingMove } from '../components/RecordingMove'
import { LibraryContentList } from '../components/LibraryContentList'
import { ContextDialog } from '../components/ReferenceContextEditor'
import { AudioImportDialog } from '../components/AudioImportDialog'
import type { LibraryScope, WrittenNote } from '../shared/notes'
import type { LibraryContentOptions } from '../shared/library'
import type { RecordingView } from '../shared/contracts'

const ProjectBriefingPanel = lazy(() => import('../components/ProjectBriefingPanel'))
const RecordingPage = lazy(() => import('./RecordingPage').then(module => ({ default: module.RecordingPage })))
const NoteEditor = lazy(() => import('../components/NoteEditor'))
const HistoricalNote = lazy(() => import('../components/NoteEditor').then(module => ({ default: module.HistoricalNote })))
export function LibraryPage(): JSX.Element {
  const [params] = useSearchParams(), { noteId, id: recordingId } = useParams(), navigate = useNavigate()
  const { projects } = useLibraryNavigation(), semantic = useSemanticSearch(), search = useAppStore(state => state.search)
  const [kind, setKind] = useState<NonNullable<LibraryContentOptions['kind']>>('all'), [status, setStatus] = useState(''), [from, setFrom] = useState('')
  const [localSearch, setLocalSearch] = useState('')
  const [searchMode, setSearchMode] = useState<'keywords' | 'meaning'>('keywords'), [focus, setFocus] = useState(false)
  const [moving, setMoving] = useState<RecordingView | null>(null), [moveNotice, setMoveNotice] = useState('')
  const moveTrigger = useRef<HTMLButtonElement | null>(null), moveCompleted = useRef(false), projectHeading = useRef<HTMLHeadingElement>(null)
  const [selectedRecording, setSelectedRecording] = useState<RecordingView | null>(null)
  const [selected, setSelected] = useState<WrittenNote | null>(null), [noteError, setNoteError] = useState(''), [loadingNote, setLoadingNote] = useState(false)
  const [creating, setCreating] = useState(false), [createError, setCreateError] = useState(''), [dropped, setDropped] = useState<File[]>()
  const [fileOver, setFileOver] = useState(false), newRequests = useRef(new Map<string | null, string>())
  const recording = selectedRecording?.id === recordingId ? selectedRecording : null
  const projectId = recording ? recording.projectId : params.get('project'), unfiled = params.get('scope') === 'unfiled' || !!recording && !recording.projectId
  const briefingMode = !noteId && !recordingId && !!projectId && params.get('view') === 'briefing'
  const selectedItem = noteId ? { id: noteId, kind: 'note' as const } : recordingId ? { id: recordingId, kind: 'recording' as const } : undefined
  const project = projects.find(value => value.id === projectId), revisionParam = params.get('revision'), revision = revisionParam ? Number(revisionParam) : undefined
  const scope: LibraryScope = projectId ? { kind: 'project', projectId } : unfiled ? { kind: 'unfiled' } : { kind: 'all' }
  const title = projectId ? project?.name ?? selected?.projectName ?? 'Project' : unfiled ? 'Unfiled items' : 'Library'
  const mode = semantic.enabled && semantic.modelReady ? searchMode : 'keywords'
  const content = useLibraryContent({ scope, query: localSearch.trim() || search, kind, status, from: from || undefined, mode, limit: 40 })
  useEffect(() => { setLocalSearch('') }, [projectId, unfiled])
  useEffect(() => {
    let current = true
    setSelected(null); setNoteError(''); setLoadingNote(!!noteId)
    if (noteId) void appClient.notes.get(noteId, revision).then(value => { if (current) setSelected(value) }).catch(error => { if (current) setNoteError(error instanceof Error ? error.message : 'This note could not be loaded.') }).finally(() => { if (current) setLoadingNote(false) })
    return () => { current = false }
  }, [noteId, revision])
  useEffect(() => { window.document.body.dataset.noteFocus = String(focus && !!noteId); return () => { delete window.document.body.dataset.noteFocus } }, [focus, noteId])
  useEffect(() => { if (!noteId) setFocus(false) }, [noteId])
  const updateNote = useCallback((note: WrittenNote) => { setSelected(note) }, [])
  const updateRecording = useCallback((value: RecordingView) => { setSelectedRecording(value) }, [])
  useEffect(() => {
    if (!recordingId || !recording) return
    if (params.get('project') === recording.projectId && (recording.projectId || params.get('scope') === 'unfiled')) return
    const next = new URLSearchParams(params); next.delete('project'); next.delete('scope')
    if (recording.projectId) next.set('project', recording.projectId); else next.set('scope', 'unfiled')
    navigate(`/library/${encodeURIComponent(recordingId)}?${next}`, { replace: true })
  }, [recordingId, recording?.projectId, params, navigate])
  useEffect(() => {
    if (!selected || selected.id !== noteId) return
    if (selected.projectId !== projectId || !selected.projectId && !unfiled) {
      const next = new URLSearchParams(params); next.delete('project'); next.delete('scope'); if (selected.projectId) next.set('project', selected.projectId); else next.set('scope', 'unfiled')
      navigate(`/notes/${encodeURIComponent(noteId)}?${next}`, { replace: true })
    }
  }, [selected?.projectId, noteId, projectId, unfiled])
  async function create(): Promise<void> {
    if (creating) return
    setCreating(true); setCreateError('')
    const requestId = newRequests.current.get(projectId) ?? randomId(); newRequests.current.set(projectId, requestId)
    try { const note = await appClient.notes.create({ requestId, projectId }); newRequests.current.delete(projectId); navigate(`${noteUrl(note.id, note.projectId)}&focusTitle=1`) }
    catch (error) { setCreateError(error instanceof Error ? error.message : 'The note could not be created. Retry with the same request.') }
    finally { setCreating(false) }
  }
  return <section className={`library-workspace ${selectedItem ? 'has-selected-item' : ''} ${focus ? 'note-focus-workspace' : ''}`} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setFileOver(true) } }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFileOver(false) }} onDrop={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setFileOver(false); setDropped([...event.dataTransfer.files]) } }}>
    {moving && <RecordingMove recording={moving} open onOpenChange={open => { if (!open) setMoving(null) }} onMoved={(_, name) => { moveCompleted.current = true; setMoveNotice(`Moved to ${name}.`) }} onClosed={() => requestAnimationFrame(() => { if (moveCompleted.current || !moveTrigger.current?.isConnected) projectHeading.current?.focus(); else moveTrigger.current.focus() })} />}
    <span className="sr-only" role="status">{moveNotice}</span>
    {createError && <p className="notice" role="alert">{createError}</p>}{fileOver && <div className="library-file-drop" role="status">Drop audio to import into {projectId ? title : 'Unfiled items'}</div>}
    <div className="library-workspace-body"><aside className="library-content-rail" aria-label="Project contents"><header className="project-workspace-heading"><div className="project-workspace-title"><h1 ref={projectHeading} tabIndex={-1}>{title}</h1><div className="project-scope-meta"><span>{content.total} item{content.total === 1 ? '' : 's'}</span><span aria-hidden="true">·</span><ContextDialog key={projectId ?? 'global'} projectId={projectId} name={title} /></div><select className="mobile-project-picker" aria-label="Open library project" value={projectId ?? (unfiled ? '__unfiled' : '')} onChange={event => navigate(event.target.value === '__unfiled' ? libraryUrl(null) : libraryUrl(event.target.value || null, !event.target.value))}><option value="">Library</option>{projects.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}<option value="__unfiled">Unfiled items</option></select></div>{projectId && <Button className="project-briefing-trigger" aria-label="Catch me up" aria-pressed={briefingMode} onClick={() => navigate(`${libraryUrl(projectId)}&view=briefing`)}><Sparkles size={14} /><span>Catch me up</span></Button>}<div className="project-workspace-actions"><Button variant="primary" busy={creating} onClick={() => { void create() }}><Plus size={15} />{createError ? 'Retry new note' : 'New note'}</Button><AudioImportDialog compact projectId={projectId} projectName={title} dropped={dropped} onDropHandled={() => setDropped(undefined)} /></div><label className="project-local-search input-with-icon"><Search size={14} /><input aria-label="Filter project contents" placeholder={projectId ? 'Filter this project' : 'Filter library'} maxLength={500} value={localSearch} onChange={event => setLocalSearch(event.target.value)} /></label></header><div className="content-rail-heading"><div><h2 className="sr-only">Project contents</h2></div><details className="recording-filters"><summary aria-label="Recording filters" title="Recording filters"><SlidersHorizontal size={17} />{(status || from) && <span className="filter-active-dot" />}</summary><div className="recording-filters-popover"><strong>Recording filters</strong><label>Status<select aria-label="Filter by recording status" value={status} onChange={event => setStatus(event.target.value)}><option value="">All statuses</option><option value="downloaded">Downloaded</option><option value="queued">Waiting for processing</option><option value="transcribing">Transcribing</option><option value="done">Transcribed</option><option value="failed">Failed</option></select></label><label>From<input type="date" aria-label="Recordings from date" value={from} onChange={event => setFrom(event.target.value)} /></label><small>Notes remain visible in All.</small></div></details></div><div className="content-rail-toolbar"><div className="content-kind-tabs" role="group" aria-label="Content type">{(['all', 'note', 'recording'] as const).map(value => <button key={value} aria-pressed={kind === value} onClick={() => setKind(value)}>{value === 'all' ? 'All' : value === 'note' ? 'Notes' : 'Recordings'}</button>)}</div></div>{search && <div className="content-rail-search"><Search size={14} /><span>{search}</span><select aria-label="Search mode" value={mode} onChange={event => setSearchMode(event.target.value as typeof mode)}><option value="keywords">Keywords</option><option value="meaning" disabled={!semantic.enabled || !semantic.modelReady}>Meaning + keywords</option></select></div>}{content.fallbackReason && search && <p className="rail-message" role="status">{content.fallbackReason}</p>}<div className="content-rail-scroll" aria-busy={content.loading}>{content.items.length ? <LibraryContentList items={content.items} selected={selectedItem} onMoveRecording={(value, trigger) => { moveTrigger.current = trigger; moveCompleted.current = false; setMoveNotice(''); setMoving(value) }} /> : <p className="rail-message">{content.loading ? 'Loading library…' : search || localSearch || status || from ? 'No matching items. Try changing your search or filters.' : 'No items yet. Write a note or add audio.'}</p>}{content.error && <div className="rail-message" role="alert"><p>{content.error}</p><Button onClick={() => { void content.retry() }}>Retry</Button></div>}{content.nextCursor && <Button className="load-more-content" busy={content.loading} onClick={() => { void content.more() }}>Load more items</Button>}</div></aside>
    <div className={`library-document-area ${recordingId ? 'library-recording-area' : ''}`}>{(selectedItem || briefingMode) && <Link className="mobile-project-contents" to={libraryUrl(projectId, !projectId && !unfiled)}><ArrowLeft size={15} />Project contents</Link>}{recordingId ? <Suspense fallback={<p className="note-editor-loading" role="status">Opening recording…</p>}><RecordingPage onRecordingChange={updateRecording} /></Suspense> : noteId ? loadingNote ? <p className="note-editor-loading" role="status">Opening note…</p> : noteError ? <div className="note-editor-loading" role="alert"><p>{noteError}</p><Link to={libraryUrl(projectId)}>Project contents</Link></div> : selected && <Suspense fallback={<p className="note-editor-loading" role="status">Loading editor…</p>}>{revision !== undefined ? <HistoricalNote key={`${selected.id}:${revision}`} note={selected} blockId={params.get('block')} /> : <NoteEditor key={selected.id} note={selected} focus={focus} setFocus={setFocus} focusTitle={params.get('focusTitle') === '1'} blockId={params.get('block')} onNote={updateNote} />}</Suspense> : briefingMode && projectId ? <Suspense fallback={<p className="note-editor-loading" role="status">Opening project briefing…</p>}><ProjectBriefingPanel key={projectId} projectId={projectId} projectName={title} /></Suspense> : <EmptyState icon={<FileText size={32} />} title="Room for your next idea">Choose a note or recording to open here, or create a new note.<br /><Button variant="primary" busy={creating} onClick={() => { void create() }}><Plus size={16} />New note</Button></EmptyState>}</div></div>
  </section>
}
