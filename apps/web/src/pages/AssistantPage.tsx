import { appClient } from '../services/app-client'
import { useEffect, useRef, useState } from 'react'
import { ArrowUp, ChevronRight, LoaderCircle, MessageSquare, Plus, Square } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { AIState, SourceCitation } from '../shared/ai'
import type { ProjectView } from '../shared/contracts'
import type { ConversationDetail } from '../shared/conversations'
import { Button, EmptyState, formatDuration } from '../components/ui'
import { reportError } from '../store/useAppStore'
import { MarkdownContent } from '../components/MarkdownContent'
import { CopyAnswer } from '../components/CopyAnswer'
import { AssistantWorkspace } from '../components/AssistantWorkspace'
import { AssistantSourcePanel } from '../components/AssistantSourcePanel'
import { ConversationHistory } from '../components/ConversationHistory'
import { BrandMark } from '../components/BrandMark'

const sourceKey = (source: SourceCitation): string => source.kind === 'note' ? `note:${source.noteId}:${source.revision}:${source.blockId}` : `recording:${source.recordingId}:${source.start}`

export function AssistantPage(): JSX.Element {
  const [state, setState] = useState<AIState | null>(null), [projects, setProjects] = useState<ProjectView[]>([])
  const [detail, setDetail] = useState<ConversationDetail | null>(null), [project, setProject] = useState(''), [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(true), [earlierLoading, setEarlierLoading] = useState(false), [sending, setSending] = useState<string | null>(null)
  const [pending, setPending] = useState<{ id: string; text: string } | null>(null), [source, setSource] = useState<SourceCitation | null>(null)
  const selected = useRef<string | null>(null), revision = useRef(0), drafts = useRef(new Map<string, string>()), cancelled = useRef(new Set<string>())
  const sourceTrigger = useRef<HTMLButtonElement | null>(null), composer = useRef<HTMLTextAreaElement>(null), end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let mounted = true
    const refreshAI = (): void => { void appClient.ai.getState().then(value => { if (mounted) setState(value) }).catch(reportError) }
    refreshAI()
    void appClient.projects.list().then(value => { if (mounted) setProjects(value) }).catch(reportError)
    void appClient.conversations.current().then(value => { if (mounted && revision.current === 0) { selected.current = value?.conversation.id ?? null; setDetail(value); setProject(value?.conversation.projectId ?? ''); setQuestion(value?.conversation.responding ? '' : value?.conversation.draft ?? '') } }).catch(reportError).finally(() => { if (mounted) setLoading(false) })
    const refreshChat = (id: string): void => {
      if (selected.current !== id) return
      const request = ++revision.current
      void appClient.conversations.get(id).then(value => { if (mounted && selected.current === id && request === revision.current) setDetail(value) }).catch(reportError)
    }
    const offAI = appClient.library.onChanged(() => { refreshAI(); if (selected.current) refreshChat(selected.current) })
    const offChat = appClient.conversations.onChanged(refreshChat)
    return () => { mounted = false; offAI(); offChat() }
  }, [])
  useEffect(() => { const conversation = end.current?.parentElement; conversation?.scrollTo({ top: conversation.scrollHeight, behavior: 'smooth' }) }, [detail?.messages.at(-1)?.id, pending])
  useEffect(() => { const textarea = composer.current; if (textarea) { textarea.style.height = 'auto'; textarea.style.height = `${Math.max(68, Math.min(180, textarea.scrollHeight))}px` } }, [question])
  const usingPlan = state?.settings.chat.provider === 'chatgpt'
  const ready = usingPlan ? !!state?.chatgpt?.planEnabled && !state.chatgpt.usageBlocked : !!state?.providers.find(provider => provider.provider === state.settings.chat.provider)?.verified
  const busy = !!detail?.conversation.responding || !!sending && sending === detail?.conversation.id
  const draftKey = detail?.conversation.id ?? `new:${project}`
  function changeQuestion(value: string): void { setQuestion(value); drafts.current.set(draftKey, value) }
  function newChat(nextProject = project): void {
    ++revision.current; selected.current = null; setDetail(null); setSource(null); setProject(nextProject); setLoading(false); setQuestion(drafts.current.get(`new:${nextProject}`) ?? '')
  }
  async function selectChat(id: string): Promise<void> {
    const request = ++revision.current
    selected.current = id; setSource(null); setLoading(true)
    try {
      const value = await appClient.conversations.select(id)
      if (request === revision.current && selected.current === id) { setDetail(value); setProject(value.conversation.projectId ?? ''); setQuestion(drafts.current.get(id) ?? (value.conversation.responding ? '' : value.conversation.draft) ?? '') }
    } catch (error) { if (request === revision.current) newChat(); reportError(error) } finally { if (request === revision.current) setLoading(false) }
  }
  async function ask(): Promise<void> {
    const text = question.trim()
    if (!text || sending || busy || !ready || loading) return
    let target = detail
    const request = revision.current
    try {
      if (!target) {
        setLoading(true)
        target = await appClient.conversations.create(project || null)
        if (request !== revision.current) return
        selected.current = target.conversation.id; setDetail(target); setLoading(false)
      }
      const id = target.conversation.id
      cancelled.current.delete(id); drafts.current.delete(draftKey); setSending(id); setQuestion(''); setPending({ id, text })
      const result = await appClient.conversations.send(id, text, target.conversation.version)
      if (selected.current === id) { setPending(null); setDetail(result) }
    } catch (error) {
      if (!target || selected.current === target.conversation.id) { setQuestion(value => value || text); const key = target?.conversation.id ?? draftKey; if (!drafts.current.get(key)) drafts.current.set(key, text) }
      if (!target || !cancelled.current.has(target.conversation.id)) reportError(error)
    } finally { if (!target || selected.current === target.conversation.id) setLoading(false); setSending(null); setPending(null) }
  }
  async function loadEarlier(): Promise<void> {
    if (!detail?.messages.length) return
    const id = detail.conversation.id
    setEarlierLoading(true)
    try {
      const page = await appClient.conversations.get(id, detail.messages[0].ordinal)
      if (selected.current === id) setDetail(current => current && current.conversation.version === page.conversation.version ? { ...current, hasEarlier: page.hasEarlier, messages: [...page.messages, ...current.messages] } : current)
    } catch (error) { reportError(error) } finally { setEarlierLoading(false) }
  }
  function closeSource(): void { setSource(null); sourceTrigger.current?.focus() }
  return <AssistantWorkspace chat={<div className="page assistant-page"><div className="page-heading"><div><h1>Assistant</h1>{detail && <p className="assistant-chat-title" title={detail.conversation.title}>{detail.conversation.title}</p>}</div><div className="assistant-header-actions"><ConversationHistory selected={detail?.conversation.id ?? null} onSelect={id => { void selectChat(id) }} onSaved={value => { if (selected.current === value.conversation.id) setDetail(value) }} onDeleted={id => { drafts.current.delete(id); if (selected.current === id) newChat() }} /><Button aria-label="New chat" onClick={() => newChat()}><Plus size={17} /></Button><select aria-label="Assistant project" value={project} onChange={event => newChat(event.target.value)}><option value="">All projects</option>{projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div></div>
    {!ready && <div className="processing-banner"><div><MessageSquare size={17} /><strong>{usingPlan && state?.chatgpt?.usageBlocked ? 'ChatGPT plan requests are paused. Review Manage usage and retry in Settings.' : 'Connect your selected chat provider in Settings to ask questions.'}</strong><Link to="/settings?tab=ai">Set up AI</Link></div></div>}
    <div className="conversation" role="log" aria-label="Conversation" aria-live="polite" aria-busy={loading}>
      {loading ? <p className="muted">Opening chat…</p> : <>{detail?.hasEarlier && <Button className="load-earlier" busy={earlierLoading} onClick={() => { void loadEarlier() }}>Load earlier messages</Button>}{detail?.messages.length ? detail.messages.map(message => <div className={`chat-message chat-${message.role}`} key={message.id}><strong>{message.role === 'user' ? 'You' : 'Assistant'}</strong>{message.role === 'assistant' ? <><MarkdownContent>{message.content}</MarkdownContent>{message.citations.length > 0 && <div className="chat-sources">{message.citations.map(citation => <button type="button" key={citation.number} aria-label={`Review source ${citation.number}: ${citation.title}`} aria-expanded={!!source && sourceKey(source) === sourceKey(citation)} onClick={event => { sourceTrigger.current = event.currentTarget; setSource(citation) }}><span className="source-number">{citation.number}</span><span className="source-title">{citation.title}</span><small>{citation.kind === 'note' ? `Written note · rev ${citation.revision}` : formatDuration(citation.start)}</small><ChevronRight size={14} /></button>)}</div>}<div className="chat-answer-actions"><CopyAnswer text={message.content} /></div></> : <p>{message.content}</p>}</div>) : !busy && <EmptyState icon={<BrandMark size={64} />} title="What would you like to find?">Find decisions, action items, or next steps.</EmptyState>}
      {busy && (pending?.id === detail?.conversation.id || detail?.conversation.draft) && <div className="chat-message chat-user"><strong>You</strong><p>{pending?.id === detail?.conversation.id ? pending?.text : detail?.conversation.draft}</p></div>}{busy && <div className="assistant-thinking" role="status"><span className="thinking-dots" aria-hidden="true"><i /><i /><i /></span><span>Reviewing your library sources…</span></div>}</>}<div ref={end} />
    </div>
    <div className="assistant-composer"><form className="assistant-form" onSubmit={event => { event.preventDefault(); void ask() }}><textarea ref={composer} aria-label="Ask about your library" placeholder="Ask about your library…" rows={3} maxLength={4000} value={question} disabled={!ready || loading} onChange={event => changeQuestion(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void ask() } }} /><div className="composer-actions"><span>{usingPlan ? 'ChatGPT plan' : state?.settings.chat.provider === 'gemini' ? 'Google Gemini' : 'OpenAI'}<span className="composer-model"> · {state?.settings.chat.model}</span>{usingPlan && <button type="button" className="composer-plan-usage" onClick={() => { void appClient.ai.chatgpt.manageUsage().catch(reportError) }}>Manage usage</button>}</span>{busy && detail ? <Button type="button" className="assistant-send" aria-label="Stop answer" onClick={() => { const id = detail.conversation.id; cancelled.current.add(id); void appClient.conversations.cancel(id).catch(reportError) }}><Square size={16} /></Button> : <Button type="submit" className="assistant-send" aria-label="Send message" variant="primary" disabled={!!sending || !ready || loading || !question.trim()}>{loading ? <LoaderCircle className="animate-spin" size={19} /> : <ArrowUp size={19} />}</Button>}</div></form></div>
  </div>} source={source ? <AssistantSourcePanel key={sourceKey(source)} citation={source} onClose={closeSource} /> : null} />
}
