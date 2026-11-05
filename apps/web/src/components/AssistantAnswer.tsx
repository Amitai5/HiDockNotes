import { lazy, Suspense, useRef, useState } from 'react'
import { ChevronRight, FilePlus2, FileText } from 'lucide-react'
import type { SourceCitation } from '../shared/ai'
import type { SavedChatMessage } from '../shared/conversations'
import type { ProjectView } from '../shared/contracts'
import { MarkdownContent } from './MarkdownContent'
import { CopyAnswer } from './CopyAnswer'
import { formatDuration } from './ui'
import type { AnswerNoteMode, AnswerNoteSnapshot } from './AssistantNoteDialog'

const AssistantNoteDialog = lazy(() => import('./AssistantNoteDialog'))
export function AssistantAnswer({ message, title, projectId, projects, activeSource, onSource }: { message: SavedChatMessage; title: string; projectId: string | null; projects: ProjectView[]; activeSource: string | null; onSource(citation: SourceCitation, trigger: HTMLElement): void }): JSX.Element {
  const body = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement | null>(null)
  const [save, setSave] = useState<{ mode: AnswerNoteMode; answer: AnswerNoteSnapshot } | null>(null)
  function open(mode: AnswerNoteMode, button: HTMLButtonElement): void { trigger.current = button; setSave({ mode, answer: { html: body.current?.innerHTML ?? '', citations: structuredClone(message.citations), title: title.trim() || 'Assistant note', projectId } }) }
  return <><div ref={body}><MarkdownContent citations={message.citations} onCitation={onSource}>{message.content}</MarkdownContent></div>
    {message.citations.length > 0 && <div className="chat-sources">{message.citations.map(citation => <button type="button" key={citation.number} aria-label={`Review source ${citation.number}: ${citation.title}`} aria-expanded={activeSource === (citation.kind === 'note' ? `note:${citation.noteId}:${citation.revision}:${citation.blockId}` : `recording:${citation.recordingId}:${citation.start}`)} onClick={event => onSource(citation, event.currentTarget)}><span className="source-number">{citation.number}</span><span className="source-info"><strong className="source-title">{citation.title}</strong><span className="source-excerpt">{citation.excerpt}</span></span><small>{citation.kind === 'note' ? `Written note · rev ${citation.revision}` : formatDuration(citation.start)}</small><ChevronRight size={14} /></button>)}</div>}
    <div className="chat-answer-actions"><CopyAnswer text={message.content} /><button className="answer-note-action" type="button" onClick={event => open('create', event.currentTarget)}><FileText size={15} />Save as note</button><button className="answer-note-action" type="button" onClick={event => open('append', event.currentTarget)}><FilePlus2 size={15} />Append to note</button></div>
    {save && <Suspense fallback={<p role="status">Opening note options…</p>}><AssistantNoteDialog key={save.mode} {...save} projects={projects} onClose={() => setSave(null)} onClosed={() => trigger.current?.focus()} onMode={mode => setSave(current => current && { ...current, mode })} /></Suspense>}
  </>
}
