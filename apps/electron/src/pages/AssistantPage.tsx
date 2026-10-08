import { useEffect, useRef, useState } from 'react'
import { ArrowUp, ArrowUpRight, AudioLines, MessageSquare } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { AIState, ChatMessage, RecordingCitation } from '../shared/ai'
import type { ProjectView } from '../shared/contracts'
import { Button, EmptyState, formatDuration } from '../components/ui'
import { reportError } from '../store/useAppStore'

interface ConversationItem extends ChatMessage { citations?: RecordingCitation[] }
export function AssistantPage(): JSX.Element {
  const [state, setState] = useState<AIState | null>(null)
  const [projects, setProjects] = useState<ProjectView[]>([])
  const [project, setProject] = useState('')
  const [messages, setMessages] = useState<ConversationItem[]>([])
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { let mounted = true; const refresh = (): void => { void window.electronAPI.ai.getState().then(value => { if (mounted) setState(value) }).catch(reportError) }; refresh(); void window.electronAPI.projects.list().then(setProjects).catch(reportError); const unsubscribe = window.electronAPI.library?.onChanged?.(refresh); return () => { mounted = false; unsubscribe?.() } }, [])
  useEffect(() => { const conversation = end.current?.parentElement; if (conversation) conversation.scrollTo({ top: conversation.scrollHeight, behavior: 'smooth' }) }, [messages, busy])
  const usingPlan = state?.settings.chat.provider === 'chatgpt'
  const ready = usingPlan ? !!state?.chatgpt?.planEnabled && !state.chatgpt.usageBlocked : !!state?.providers.find(provider => provider.provider === state.settings.chat.provider)?.verified
  async function ask(): Promise<void> {
    const text = question.trim()
    if (!text || busy || !ready) return
    setBusy(true); setQuestion(''); setMessages(previous => [...previous, { role: 'user', content: text }])
    try { const answer = await window.electronAPI.assistant.ask(text, project || null, messages.slice(-6)); setMessages(previous => [...previous, { role: 'assistant', content: answer.text, citations: answer.citations }]) }
    catch (error) { reportError(error); setQuestion(text); setMessages(previous => previous.slice(0, -1)) }
    finally { setBusy(false) }
  }
  return <div className="page assistant-page"><div className="page-heading"><div><h1>Assistant</h1><p>Ask questions about your recordings, with sources you can open.</p></div><select aria-label="Assistant project" value={project} disabled={busy} onChange={event => { setProject(event.target.value); setMessages([]) }}><option value="">All projects</option>{projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
    {!ready && <div className="processing-banner"><div><MessageSquare size={17} /><strong>{usingPlan && state?.chatgpt?.usageBlocked ? 'ChatGPT plan requests are paused. Review Manage usage and retry in Settings.' : 'Connect your selected chat provider in Settings to ask questions.'}</strong><Link to="/settings">Set up AI</Link></div></div>}
    <div className="conversation" role="log" aria-label="Conversation" aria-live="polite">{messages.length ? messages.map((message, index) => <div className={`chat-message chat-${message.role}`} key={index}><strong>{message.role === 'user' ? 'You' : 'Assistant'}</strong><p>{message.content}</p>{message.citations?.length ? <div className="chat-sources">{message.citations.map(citation => <Link key={citation.number} to={`/library/${citation.recordingId}?t=${citation.start}`}><span>[{citation.number}] {citation.title}</span><small>{formatDuration(citation.start)}</small><ArrowUpRight size={14} /></Link>)}</div> : null}</div>) : <EmptyState icon={<AudioLines size={30} />} title="What would you like to find?">Ask about a decision, find an action item, or pull together the next steps from your recordings.</EmptyState>}{busy && <p className="assistant-thinking" role="status">Searching transcripts and preparing an answer…</p>}<div ref={end} /></div>
    <div className="assistant-composer">
      <form className="assistant-form" onSubmit={event => { event.preventDefault(); void ask() }}><textarea aria-label="Ask about your recordings" placeholder="Ask about your recordings…" rows={3} maxLength={4000} value={question} disabled={!ready || busy} onChange={event => setQuestion(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void ask() } }} /><div className="composer-actions"><span>{usingPlan ? 'ChatGPT plan' : state?.settings.chat.provider === 'gemini' ? 'Google Gemini' : 'OpenAI'}<span className="composer-model"> · {state?.settings.chat.model}</span></span><Button type="submit" className="assistant-send" aria-label="Send message" variant="primary" busy={busy} disabled={!ready || !question.trim()}><ArrowUp size={19} /></Button></div></form>
      <div className="composer-footer"><small>Enter to send · Shift + Enter for a new line</small>{usingPlan && <p className="chatgpt-plan-label">{state?.chatgpt?.usageBlocked ? state.chatgpt.error : state?.chatgpt?.planEnabled ? 'Using ChatGPT plan' : 'ChatGPT sign-in required'} · <button type="button" onClick={() => { void window.electronAPI.ai.chatgpt.manageUsage().catch(reportError) }}>Manage usage</button></p>}</div>
    </div>
  </div>
}
