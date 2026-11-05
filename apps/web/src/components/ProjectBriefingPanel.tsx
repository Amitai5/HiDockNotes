import * as Dialog from '@radix-ui/react-dialog'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, BookOpen, CheckCircle2, CircleHelp, RefreshCw, Sparkles, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { appClient } from '../services/app-client'
import { recordingUrl } from '../services/note-url'
import { BRIEFING_DAYS, type BriefingContent, type BriefingDays, type BriefingItem, type BriefingSource, type ProjectBriefingState } from '../shared/project-briefing'
import { Button, formatDuration } from './ui'

function date(value: string): string { return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) }
const SECTIONS: { key: Exclude<keyof BriefingContent, 'overview'>; title: string; empty: string }[] = [
  { key: 'changes', title: 'What changed', empty: 'No supported changes between meetings were found in these sources.' },
  { key: 'decisions', title: 'Recent decisions', empty: 'No decisions were found in these sources.' },
  { key: 'questions', title: 'Open questions', empty: 'No unresolved questions were identified in these sources.' }
]

function Claim({ item, sources, onSource }: { item: BriefingItem; sources: BriefingSource[]; onSource(source: BriefingSource): void }): JSX.Element {
  return <li><p>{item.text}</p><div className="briefing-claim-sources">{item.sources.map(number => {
    const source = sources.find(value => value.number === number)
    return source ? <button key={number} type="button" onClick={() => onSource(source)} aria-label={`Review source ${number}: ${source.title}`}><BookOpen size={12} /><span>[{number}] {source.title}</span><small>{source.basis === 'summary' ? 'Summary' : formatDuration(source.start)}</small></button> : null
  })}</div></li>
}

export default function ProjectBriefingPanel({ projectId, projectName }: { projectId: string; projectName?: string }): JSX.Element {
  const [days, setDays] = useState<BriefingDays>(30), [state, setState] = useState<ProjectBriefingState | null>(null)
  const [loading, setLoading] = useState(true), [generating, setGenerating] = useState(false), [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [source, setSource] = useState<BriefingSource | null>(null)
  const alive = useRef(true), request = useRef(0), sourceTrigger = useRef<HTMLButtonElement | null>(null)
  const load = useCallback(async (): Promise<void> => {
    const current = ++request.current
    try { const result = await appClient.projectBriefing.get(projectId, { days }); if (alive.current && current === request.current) { setState(result); setLoadError('') } }
    catch (value) { if (alive.current && current === request.current) setLoadError(value instanceof Error ? value.message : 'The project briefing could not be loaded.') }
    finally { if (alive.current && current === request.current) setLoading(false) }
  }, [projectId, days])
  useEffect(() => {
    alive.current = true; setLoading(true); setState(null); setSource(null); setError(''); setLoadError(''); void load()
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = appClient.library.onChanged(() => { clearTimeout(timer); timer = setTimeout(() => { void load() }, 200) })
    return () => { alive.current = false; ++request.current; clearTimeout(timer); off() }
  }, [load])
  async function generate(): Promise<void> {
    if (generating || !state?.canGenerate) return
    const requestedDays = days
    setGenerating(true); setError(''); setSource(null)
    try {
      const result = await appClient.projectBriefing.generate(projectId, { days: requestedDays })
      if (alive.current) { ++request.current; setState(result) }
    } catch (value) { if (alive.current) setError(value instanceof Error ? value.message : 'The briefing could not be generated. Try again.') }
    finally { if (alive.current) { setGenerating(false); void load() } }
  }
  async function cancel(): Promise<void> {
    try { await appClient.projectBriefing.cancel(projectId); await load() }
    catch (value) { if (alive.current) setError(value instanceof Error ? value.message : 'The generation could not be cancelled.') }
  }
  const busy = generating || !!state?.busy, briefing = state?.briefing
  return <article className="project-briefing" aria-label="Project catch-up">
    <header className="briefing-heading"><div><span className="briefing-eyebrow"><Sparkles size={15} />Project briefing</span><h2>{state?.project.name ?? projectName ?? 'Project'} <span className="muted">/</span> Catch me up</h2><p>Decisions, developments and questions from your recent meetings.</p></div><div className="briefing-controls"><div className="briefing-periods" role="group" aria-label="Briefing period">{BRIEFING_DAYS.map(value => <button key={value} type="button" aria-pressed={days === value} disabled={busy} onClick={() => { setError(''); setDays(value) }}>{value} days</button>)}</div><Button variant="primary" busy={busy} disabled={loading || !state?.canGenerate} onClick={() => { void generate() }}><RefreshCw size={15} />{busy ? 'Generating…' : briefing ? 'Refresh briefing' : 'Generate briefing'}</Button>{busy && <Button onClick={() => { void cancel() }}>Cancel</Button>}</div></header>
    <div className="briefing-document"><span className="briefing-document-label"><Sparkles size={12} /> Project briefing</span><h1 className="briefing-document-title">{state?.project.name ?? projectName ?? 'Project'} · Last {days} days</h1>
    {loading && <p className="briefing-notice" role="status">Loading project briefing…</p>}
    {(error || loadError) && <div className="briefing-notice danger-text" role="alert"><p>{error || loadError}</p>{!state && <Button onClick={() => { setError(''); setLoadError(''); setLoading(true); void load() }}>Retry</Button>}</div>}
    {state && <>
      <div className="briefing-coverage"><span><BookOpen size={15} />{state.coverage.includedMeetings} of {state.coverage.eligibleMeetings} available summarized meetings</span><span>{date(state.since)} – {date(state.until)}</span></div>
      {state.coverage.eligibleMeetings > state.coverage.includedMeetings && <p className="briefing-notice">Uses the most recent {state.coverage.includedMeetings} summarized meetings in this period. Older meetings are outside this briefing.</p>}
      {state.coverage.staleSummaries > 0 && <p className="briefing-notice">{state.coverage.staleSummaries} summar{state.coverage.staleSummaries === 1 ? 'y is' : 'ies are'} out of date after transcript edits and excluded. Resummarize those recordings to include them.</p>}
      {state.reason && !busy && <p className="briefing-notice" role="status">{state.reason} {!state.canGenerate && /Settings/.test(state.reason) && <Link to="/settings?tab=ai">AI settings</Link>}</p>}
      {state.sourcesChanged && !busy && <p className="briefing-notice" role="status">The meeting sources or project context changed. Generate a fresh briefing to use the current evidence.</p>}
      {busy && <p className="briefing-notice" role="status">Reviewing the selected meetings. You can leave this page and return when the briefing is ready.</p>}
      {briefing ? <>
        <div className="briefing-saved"><CheckCircle2 size={15} /><span>Generated {new Date(briefing.generatedAt).toLocaleString()} · {briefing.model}</span></div>
        <section className="briefing-overview" aria-label="At a glance"><h3>At a glance</h3><ul>{briefing.content.overview.map((item, index) => <Claim key={index} item={item} sources={briefing.sources} onSource={setSource} />)}</ul></section>
        <div className="briefing-sections">{SECTIONS.map(section => <section className="briefing-section" key={section.key}><h3>{section.key === 'questions' ? <CircleHelp size={18} /> : <BookOpen size={18} />}{section.title}</h3>{briefing.content[section.key].length ? <ul>{briefing.content[section.key].map((item, index) => <Claim key={index} item={item} sources={briefing.sources} onSource={setSource} />)}</ul> : <p className="briefing-empty">{section.empty}</p>}</section>)}</div>
      </> : !busy && !loading && <div className="briefing-start"><Sparkles size={30} /><h3>Your project, brought up to date</h3><p>Generate a briefing when you need it. It uses your selected chat provider and saved meeting summaries, with links to the supporting passages.</p><small>Opening this view never sends a generation request.</small></div>}
    </>}
    <p className="briefing-source-note"><BookOpen size={14} /> Each claim links to its evidence. A timestamp opens the transcript; a Summary label identifies a saved AI summary rather than a direct quote.</p></div>
    <Dialog.Root open={!!source} onOpenChange={open => { if (!open) setSource(null) }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="briefing-source-dialog" onOpenAutoFocus={event => { const trigger = window.document.activeElement; if (trigger instanceof HTMLButtonElement) sourceTrigger.current = trigger; event.preventDefault(); (event.currentTarget as HTMLElement).querySelector<HTMLButtonElement>('button')?.focus() }} onCloseAutoFocus={event => { if (sourceTrigger.current?.isConnected) { event.preventDefault(); sourceTrigger.current.focus() } }}>
      <div className="panel-heading"><Dialog.Title>{source?.title ?? 'Meeting source'}</Dialog.Title><Dialog.Close asChild><Button variant="ghost" aria-label="Close briefing source"><X size={18} /></Button></Dialog.Close></div><Dialog.Description>{source ? `${date(source.recordedAt)} · ${source.basis === 'summary' ? 'Saved AI summary; not a transcript quote' : `Transcript at ${formatDuration(source.start)}`}` : 'Supporting meeting passage'}</Dialog.Description><blockquote>{source?.excerpt}</blockquote>{source && <Dialog.Close asChild><Link className="button button-secondary" to={recordingUrl(source.recordingId, projectId) + (source.start !== null ? `&t=${source.start}` : '')}>Open recording {source.start !== null ? `at ${formatDuration(source.start)}` : ''}<ArrowUpRight size={15} /></Link></Dialog.Close>}
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </article>
}
