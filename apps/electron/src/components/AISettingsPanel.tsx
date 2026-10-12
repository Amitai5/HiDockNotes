import { useEffect, useState } from 'react'
import { CheckCircle2, KeyRound, RefreshCw, Sparkles, Trash2 } from 'lucide-react'
import type { AISettings, AIState, ChatProviderId, ProviderId, TranscriptionProviderId } from '../shared/ai'
import { DEFAULT_CHATGPT_MODELS, DEFAULT_MODELS, LOCAL_TRANSCRIPTION_MODELS } from '../shared/ai'
import { Button, Toggle } from './ui'
import { reportError } from '../store/useAppStore'
import { ChatGPTAccountPanel } from './ChatGPTAccountPanel'

export function AISettingsPanel({ sections = ['providers', 'transcription', 'thresholds'] }: { sections?: readonly ('providers' | 'transcription' | 'thresholds')[] }): JSX.Element {
  const [state, setState] = useState<AIState | null>(null)
  const [keys, setKeys] = useState<Record<ProviderId, string>>({ gemini: '', openai: '' })
  const [verifying, setVerifying] = useState<ProviderId | null>(null)
  const [busy, setBusy] = useState(false)
  const [messages, setMessages] = useState<Partial<Record<ProviderId, string>>>({})
  const [errors, setErrors] = useState<Partial<Record<ProviderId, string>>>({})
  const [language, setLanguage] = useState('auto')
  const [custom, setCustom] = useState('')
  const [thresholds, setThresholds] = useState({ suggest: 0.6, auto: 0.75 })
  const [notice, setNotice] = useState('')
  function accept(value: AIState): void { setState(value); setLanguage(value.settings.language); setCustom(value.settings.customPrompt); setThresholds({ suggest: value.settings.suggestThreshold, auto: value.settings.autoAssignThreshold }) }
  useEffect(() => {
    let mounted = true
    void window.electronAPI.ai.getState().then(value => { if (mounted) accept(value) }).catch(reportError)
    const unsubscribe = window.electronAPI.library?.onChanged?.(() => { void window.electronAPI.ai.getState().then(value => { if (mounted) setState(value) }).catch(reportError) })
    return () => { mounted = false; unsubscribe?.() }
  }, [])
  async function update(patch: Partial<AISettings>): Promise<void> {
    setBusy(true)
    try { accept(await window.electronAPI.ai.updateSettings(patch)) } catch (error) { reportError(error) } finally { setBusy(false) }
  }
  async function verify(provider: ProviderId): Promise<void> {
    setVerifying(provider); setErrors(previous => ({ ...previous, [provider]: '' })); setMessages(previous => ({ ...previous, [provider]: '' }))
    try { accept(await window.electronAPI.ai.verifyKey(provider, keys[provider])); setMessages(previous => ({ ...previous, [provider]: 'Verified with a live models request. Your key is encrypted.' })) }
    catch (error) { const message = error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Verification failed. Check the key and your connection.'; setErrors(previous => ({ ...previous, [provider]: message })) }
    finally { setKeys(previous => ({ ...previous, [provider]: '' })); setVerifying(null) }
  }
  function choose(kind: 'transcription' | 'chat', provider: ChatProviderId | TranscriptionProviderId): void {
    const model = provider === 'local' ? LOCAL_TRANSCRIPTION_MODELS[0].id : provider === 'chatgpt' ? (state?.chatgpt?.models ?? DEFAULT_CHATGPT_MODELS)[0].id : DEFAULT_MODELS[provider].find(item => item[kind])!.id
    void update({ [kind]: { provider, model } })
  }
  return <>
    {sections.includes('providers') && <section className="settings-section" id="ai-providers" tabIndex={-1}><h2><KeyRound size={18} />AI providers</h2>
      <p>Choose how to transcribe audio and how to create summaries. API keys and ChatGPT connections are encrypted on this computer.</p>
      {state && <ChatGPTAccountPanel state={state} accept={accept} />}
      <div className="provider-cards">{(['gemini', 'openai'] as const).map(provider => {
        const saved = state?.providers.find(item => item.provider === provider)
        return <div className="provider-card" key={provider}>
          <div className="provider-heading"><h3>{provider === 'gemini' ? 'Google Gemini' : 'OpenAI'}</h3>{saved?.verified ? <span className="status status-verified"><CheckCircle2 size={12} />Verified</span> : <span className="status">Not configured</span>}</div>
          <form onSubmit={event => { event.preventDefault(); void verify(provider) }}>
            <input type="password" autoComplete="off" spellCheck={false} aria-label={`${provider === 'gemini' ? 'Gemini' : 'OpenAI'} API key`} placeholder={saved?.configured ? 'Enter a replacement key' : 'Paste API key'} value={keys[provider]} maxLength={1000} onChange={event => setKeys(previous => ({ ...previous, [provider]: event.target.value }))} />
            <Button type="submit" variant="primary" busy={verifying === provider} disabled={!keys[provider].trim() || verifying !== null}>Verify &amp; save</Button>
          </form>
          {provider === 'gemini' && <small>Accepts AIza and AQ keys. Gemini’s free tier lets Google use and human-review inputs. Enable billing for business use.</small>}
          {saved?.configured && <div className="provider-tools"><Button variant="ghost" disabled={busy || verifying !== null} onClick={() => { setBusy(true); void window.electronAPI.ai.refreshModels(provider).then(value => { accept(value); setMessages(previous => ({ ...previous, [provider]: 'Model list refreshed.' })) }).catch(reportError).finally(() => setBusy(false)) }}><RefreshCw size={13} />Refresh models</Button><Button variant="ghost" disabled={busy || verifying !== null} onClick={() => { setBusy(true); void window.electronAPI.ai.removeKey(provider).then(value => { accept(value); setMessages(previous => ({ ...previous, [provider]: 'Encrypted key removed.' })) }).catch(reportError).finally(() => setBusy(false)) }}><Trash2 size={13} />Remove key</Button></div>}
          {messages[provider] && <p className="provider-success" role="status">{messages[provider]}</p>}{errors[provider] && <p className="provider-error" role="alert">{errors[provider]}</p>}
        </div>
      })}</div>
      {state && <div className="model-selections">{(['transcription', 'chat'] as const).map(kind => {
        const selected = state.settings[kind]
        const choices = selected.provider === 'local' ? LOCAL_TRANSCRIPTION_MODELS : selected.provider === 'chatgpt' ? state.chatgpt?.models ?? DEFAULT_CHATGPT_MODELS : state.providers.find(item => item.provider === selected.provider)?.models.filter(model => model[kind]) ?? []
        const defaults = selected.provider === 'local' ? LOCAL_TRANSCRIPTION_MODELS : selected.provider === 'chatgpt' ? DEFAULT_CHATGPT_MODELS : DEFAULT_MODELS[selected.provider].filter(model => model[kind])
        const models = choices.length ? choices : defaults
        return <div className="model-selection" key={kind}><label>{kind === 'transcription' ? 'Transcription' : 'Chat & summaries'}<select aria-label={`${kind === 'transcription' ? 'Transcription' : 'Chat'} provider`} value={selected.provider} disabled={busy} onChange={event => choose(kind, event.target.value as ChatProviderId | TranscriptionProviderId)}>{kind === 'transcription' && <option value="local">Local Whisper · on this computer</option>}<option value="gemini">Google Gemini</option><option value="openai">OpenAI API key</option>{kind === 'chat' && <option value="chatgpt">ChatGPT subscription</option>}</select></label><label>Model<select aria-label={`${kind === 'transcription' ? 'Transcription' : 'Chat'} model`} value={selected.model} disabled={busy} onChange={event => { void update({ [kind]: { ...selected, model: event.target.value } }) }}>{!models.some(m => m.id === selected.model) && <option value={selected.model}>{selected.model} · saved selection</option>}{models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>{kind === 'transcription' && selected.provider === 'local' && <small>No API key needed. Small downloads once (640 MB; 375 MB cached); Base is faster (208 MB; 161 MB cached). Audio stays on this computer.</small>}{kind === 'chat' && selected.provider === 'chatgpt' && <small className="chatgpt-plan-label">{state.chatgpt?.planEnabled ? 'Using ChatGPT plan' : 'ChatGPT sign-in required'} · <button type="button" onClick={() => { void window.electronAPI.ai.chatgpt.manageUsage().catch(reportError) }}>Manage usage</button></small>}</div>
      })}</div>}
      <p className="privacy-note">With Local Whisper, audio and voice embeddings stay on this computer. Choosing Gemini or OpenAI transcription uploads audio to that provider. Transcript text goes to your selected chat provider for summaries and chat.</p>
    </section>}
    {sections.includes('transcription') && <section className="settings-section" id="transcription" tabIndex={-1}><h2><Sparkles size={18} />Transcription</h2>
      <p>{state?.ready ? 'Ready. New verified downloads will be processed automatically when enabled.' : state?.reason ?? 'Loading AI settings…'}</p>
      {state?.ready && state.summaryReason && <p>Transcripts will be saved locally. {state.summaryReason} Pending summaries will be added automatically after setup.</p>}
      <div className="setting-row"><div><strong>Auto-transcribe on download</strong><p>Queue verified downloads and existing unprocessed recordings. One recording runs at a time.</p></div><Toggle label="Auto-transcribe on download" checked={state?.settings.autoTranscribe ?? true} disabled={busy || !state} onChange={value => { void update({ autoTranscribe: value }) }} /></div>
      {state && <div className="transcription-options"><label>Summary template<select aria-label="Summary template" value={state.settings.summaryTemplate} disabled={busy} onChange={event => { void update({ summaryTemplate: event.target.value as AISettings['summaryTemplate'] }) }}><option value="meeting">Meeting</option><option value="call">Call</option><option value="interview">Interview</option><option value="dictation">Dictation</option><option value="custom">Custom prompt</option></select></label><form onSubmit={event => { event.preventDefault(); void update({ language }) }}><label>Language<input aria-label="Transcription language" value={language} onChange={event => setLanguage(event.target.value)} placeholder="auto, en, en-US…" /></label><Button type="submit" disabled={busy}>Save language</Button></form></div>}
      {state?.settings.summaryTemplate === 'custom' && <form className="custom-summary-form" onSubmit={event => { event.preventDefault(); void update({ customPrompt: custom }) }}><label>Custom summary instructions<textarea aria-label="Custom summary instructions" maxLength={4000} value={custom} onChange={event => setCustom(event.target.value)} rows={4} /></label><Button type="submit" disabled={busy}>Save prompt</Button></form>}
      <div className="process-saved"><Button variant="primary" disabled={!state?.ready || busy} onClick={() => { setBusy(true); void window.electronAPI.ai.processPending().then(count => setNotice(count ? `${count} saved recording${count === 1 ? '' : 's'} queued.` : 'All saved recordings are already queued or processed. Retry failed recordings from their Library page.')).catch(reportError).finally(() => setBusy(false)) }}>Process saved recordings</Button>{notice && <small role="status">{notice}</small>}</div>
      <small>Base is recommended for faster CPU transcription; Small trades speed for accuracy. Silent sections are skipped, and completed transcription and speaker sections are saved so retries resume their work. Speaker models download once (about 47 MB).</small>
    </section>}
    {sections.includes('thresholds') && <section className="settings-section" id="voice-thresholds" tabIndex={-1}><h2>Voice recognition thresholds</h2><p>A suggestion needs your confirmation; a stronger match receives the name automatically.</p><form className="threshold-form" onSubmit={event => { event.preventDefault(); void update({ suggestThreshold: thresholds.suggest, autoAssignThreshold: thresholds.auto }) }}><label>Suggest at<input aria-label="Voice suggestion threshold" type="number" min="0" max="1" step="0.01" value={thresholds.suggest} onChange={event => setThresholds(previous => ({ ...previous, suggest: Number(event.target.value) }))} /></label><label>Auto-assign at<input aria-label="Voice auto-assign threshold" type="number" min="0" max="1" step="0.01" value={thresholds.auto} onChange={event => setThresholds(previous => ({ ...previous, auto: Number(event.target.value) }))} /></label><Button type="submit" disabled={busy || !state}>Save thresholds</Button></form><small>Defaults: 0.60 for suggestions (sherpa’s identification example), 0.75 for automatic labels. These are starting values; raise them if voices are confused.</small></section>}
  </>
}
