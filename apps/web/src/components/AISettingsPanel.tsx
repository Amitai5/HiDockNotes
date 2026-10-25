import { appClient } from '../services/app-client'
import { useEffect, useState } from 'react'
import { KeyRound, Sparkles } from 'lucide-react'
import type { AISettings, AIState, ChatProviderId, TranscriptionProviderId } from '../shared/ai'
import { DEFAULT_CHATGPT_MODELS, DEFAULT_MODELS, LOCAL_TRANSCRIPTION_MODELS } from '../shared/ai'
import { Button, Toggle } from './ui'
import { reportError } from '../store/useAppStore'
import { ProviderConnectionDialog, providerNames, type ProviderConnectionSelection } from './ProviderConnectionDialog'
import { ParallelProcessingSettings } from './ParallelProcessingSettings'
import { ProcessingControls } from './ProcessingControls'

export function AISettingsPanel({ sections = ['providers', 'transcription', 'thresholds'] }: { sections?: readonly ('providers' | 'transcription' | 'thresholds')[] }): JSX.Element {
  const [state, setState] = useState<AIState | null>(null)
  const [busy, setBusy] = useState(false)
  const [language, setLanguage] = useState('auto')
  const [custom, setCustom] = useState('')
  const [thresholds, setThresholds] = useState({ suggest: 0.6, auto: 0.75 })
  const [notice, setNotice] = useState(''), [providerNotice, setProviderNotice] = useState('')
  const [connection, setConnection] = useState<ProviderConnectionSelection | null>(null)
  function accept(value: AIState): void { setState(value); setLanguage(value.settings.language); setCustom(value.settings.customPrompt); setThresholds({ suggest: value.settings.suggestThreshold, auto: value.settings.autoAssignThreshold }) }
  useEffect(() => {
    let mounted = true
    void appClient.ai.getState().then(value => { if (mounted) accept(value) }).catch(reportError)
    const unsubscribe = appClient.library?.onChanged?.(() => { void appClient.ai.getState().then(value => { if (mounted) setState(value) }).catch(reportError) })
    return () => { mounted = false; unsubscribe?.() }
  }, [])
  async function update(patch: Partial<AISettings>): Promise<void> {
    setBusy(true)
    try { accept(await appClient.ai.updateSettings(patch)) } catch (error) { reportError(error) } finally { setBusy(false) }
  }
  function choose(kind: 'transcription' | 'chat', provider: ChatProviderId | TranscriptionProviderId): void {
    if (provider !== 'local') { setProviderNotice(''); setConnection({ provider, kind }); return }
    void update({ transcription: { provider, model: LOCAL_TRANSCRIPTION_MODELS[0].id } })
  }
  async function useProvider(value: AIState): Promise<void> {
    if (!connection) return
    const { kind, provider } = connection
    const current = value.settings[kind]
    const model = current.provider === provider ? current.model : provider === 'chatgpt' ? (value.chatgpt?.models?.[0]?.id ?? DEFAULT_CHATGPT_MODELS[0].id) : kind === 'transcription' ? DEFAULT_MODELS[provider].find(item => item.transcription)!.id : value.providers.find(item => item.provider === provider)?.models.find(item => item.chat)?.id ?? DEFAULT_MODELS[provider].find(item => item.chat)!.id
    accept(await appClient.ai.updateSettings({ [kind]: { provider, model } }))
    setProviderNotice(providerNames[provider] + ' selected for ' + (kind === 'chat' ? 'chat and summaries.' : 'transcription.')); setConnection(null)
  }
  return <>
    {sections.includes('providers') && <section className="settings-section" id="ai-providers" tabIndex={-1}><h2><KeyRound size={18} />AI providers</h2>

      {state && <div className="model-selections">{(['transcription', 'chat'] as const).map(kind => {
        const selected = state.settings[kind]
        const choices = selected.provider === 'local' ? LOCAL_TRANSCRIPTION_MODELS : selected.provider === 'chatgpt' ? state.chatgpt?.models ?? DEFAULT_CHATGPT_MODELS : state.providers.find(item => item.provider === selected.provider)?.models.filter(model => model[kind]) ?? []
        const defaults = selected.provider === 'local' ? LOCAL_TRANSCRIPTION_MODELS : selected.provider === 'chatgpt' ? DEFAULT_CHATGPT_MODELS : DEFAULT_MODELS[selected.provider].filter(model => model[kind])
        const models = choices.length ? choices : defaults
        return <div className="model-selection" key={kind}><label>{kind === 'transcription' ? 'Transcription' : 'Chat & summaries'}<select aria-label={`${kind === 'transcription' ? 'Transcription' : 'Chat'} provider`} id={`provider-${kind}`} value={connection?.kind === kind ? connection.provider : selected.provider} disabled={busy} onChange={event => choose(kind, event.target.value as ChatProviderId | TranscriptionProviderId)}>{kind === 'transcription' && <option value="local">Local Whisper · on your server</option>}<option value="gemini">Google Gemini</option><option value="openai">OpenAI API key</option>{kind === 'chat' && <option value="chatgpt">ChatGPT subscription</option>}</select></label><label>Model<select aria-label={`${kind === 'transcription' ? 'Transcription' : 'Chat'} model`} value={selected.model} disabled={busy} onChange={event => { void update({ [kind]: { ...selected, model: event.target.value } }) }}>{!models.some(m => m.id === selected.model) && <option value={selected.model}>{selected.model} · saved selection</option>}{models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>{kind === 'transcription' && selected.provider === 'local' && <p className="model-hint">Base: faster · Small: more accurate</p>}{selected.provider !== 'local' && <div className="selected-provider-connection"><small>{selected.provider === 'chatgpt' ? state.chatgpt?.planEnabled ? 'Using ChatGPT plan' : 'ChatGPT sign-in required' : state.providers.find(item => item.provider === selected.provider)?.verified ? 'Verified connection' : 'Connection required'}</small><Button variant="ghost" disabled={busy} aria-label={`Manage ${providerNames[selected.provider]} connection for ${kind}`} onClick={() => setConnection({ provider: selected.provider as ChatProviderId, kind })}>Manage connection</Button></div>}</div>
      })}</div>}
      {providerNotice && <p role="status" className="provider-success">{providerNotice}</p>}
      <p className="privacy-note">Cloud transcription shares audio. Summaries and chat share transcript text.</p>
    </section>}
    {sections.includes('transcription') && <section className="settings-section" id="transcription" tabIndex={-1}><h2><Sparkles size={18} />Transcription</h2>
      <p>{state?.ready ? 'Ready' : state?.reason ?? 'Loading AI settings…'}</p>
      {state && <ProcessingControls state={state} onChanged={accept} />}
      {state?.ready && state.summaryReason && <p>{state.summaryReason}</p>}
      <div className="setting-row"><div><strong>Auto-transcribe on download</strong></div><Toggle label="Auto-transcribe on download" checked={state?.settings.autoTranscribe ?? true} disabled={busy || !state} onChange={value => { void update({ autoTranscribe: value }) }} /></div>
      {state && <div className="transcription-options"><label>Summary template<select aria-label="Summary template" value={state.settings.summaryTemplate} disabled={busy} onChange={event => { void update({ summaryTemplate: event.target.value as AISettings['summaryTemplate'] }) }}><option value="meeting">Meeting</option><option value="call">Call</option><option value="interview">Interview</option><option value="dictation">Dictation</option><option value="custom">Custom prompt</option></select></label><form onSubmit={event => { event.preventDefault(); void update({ language }) }}><label>Language<input aria-label="Transcription language" value={language} onChange={event => setLanguage(event.target.value)} placeholder="auto, en, en-US…" /></label><Button type="submit" disabled={busy}>Save language</Button></form></div>}
      {state?.settings.summaryTemplate === 'custom' && <form className="custom-summary-form" onSubmit={event => { event.preventDefault(); void update({ customPrompt: custom }) }}><label>Custom summary instructions<textarea aria-label="Custom summary instructions" maxLength={4000} value={custom} onChange={event => setCustom(event.target.value)} rows={4} /></label><Button type="submit" disabled={busy}>Save prompt</Button></form>}
      {state && <ParallelProcessingSettings settings={state.settings} busy={busy} save={update} />}
      <div className="process-saved"><Button variant="primary" disabled={!state?.ready || busy} onClick={() => { setBusy(true); void appClient.ai.processPending().then(count => setNotice(count ? `${count} saved recording${count === 1 ? '' : 's'} queued.` : 'All saved recordings are already queued or processed. Retry failed recordings from their Library page.')).catch(reportError).finally(() => setBusy(false)) }}>Process saved recordings</Button>{notice && <small role="status">{notice}</small>}</div>

    </section>}
    {connection && state && <ProviderConnectionDialog selection={connection} state={state} accept={accept} useProvider={useProvider} close={() => setConnection(null)} />}
    {sections.includes('thresholds') && <section className="settings-section" id="voice-thresholds" tabIndex={-1}><h2>Voice recognition thresholds</h2><p>Raise thresholds to reduce false matches.</p><form className="threshold-form" onSubmit={event => { event.preventDefault(); void update({ suggestThreshold: thresholds.suggest, autoAssignThreshold: thresholds.auto }) }}><label>Suggest at<input aria-label="Voice suggestion threshold" type="number" min="0" max="1" step="0.01" value={thresholds.suggest} onChange={event => setThresholds(previous => ({ ...previous, suggest: Number(event.target.value) }))} /></label><label>Auto-assign at<input aria-label="Voice auto-assign threshold" type="number" min="0" max="1" step="0.01" value={thresholds.auto} onChange={event => setThresholds(previous => ({ ...previous, auto: Number(event.target.value) }))} /></label><Button type="submit" disabled={busy || !state}>Save thresholds</Button></form></section>}
  </>
}
