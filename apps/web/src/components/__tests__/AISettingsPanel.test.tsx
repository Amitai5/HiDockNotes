// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { appClient, setAppClient } from '../../services/app-client'
import { AISettingsPanel } from '../AISettingsPanel'
import type { AppClient } from '../../shared/contracts'
import type { AISettings, AIState } from '../../shared/ai'
import { DEFAULT_AI_SETTINGS, DEFAULT_MODELS } from '../../shared/ai'

describe('selected provider setup and processing settings', () => {
  let state: AIState
  const verifyKey = vi.fn(), updateSettings = vi.fn()
  beforeEach(() => {
    state = { settings: structuredClone(DEFAULT_AI_SETTINGS), providers: (['gemini', 'openai'] as const).map(provider => ({ provider, configured: false, verified: false, verifiedAt: null, models: DEFAULT_MODELS[provider], offline: true })), ready: true, reason: null }
    verifyKey.mockReset().mockImplementation(async (provider: string) => { state.providers = state.providers.map(item => item.provider === provider ? { ...item, configured: true, verified: true, offline: false } : item); return structuredClone(state) })
    updateSettings.mockReset().mockImplementation(async (patch: Partial<AISettings>) => { state.settings = { ...state.settings, ...patch }; return structuredClone(state) })
    setAppClient({ ai: { getState: vi.fn(async () => structuredClone(state)), verifyKey, updateSettings } } as unknown as AppClient)
  })
  afterEach(cleanup)
  async function choose(kind: 'Transcription' | 'Chat', provider: string) { fireEvent.change(await screen.findByLabelText(`${kind} provider`), { target: { value: provider } }); return await screen.findByRole('dialog') }
  it('shows no key fields or connection popups when settings first opens', async () => {
    render(<AISettingsPanel />); await screen.findByLabelText('Transcription provider')
    expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.queryByLabelText('Gemini API key')).toBeNull(); expect(screen.queryByLabelText('OpenAI API key')).toBeNull()
    expect(screen.getByLabelText('Transcription provider')).toHaveValue('local')
    expect(screen.getByRole('option', { name: 'Local Whisper · on your server' })).toBeInTheDocument()
  })
  it.each([['Transcription', 'gemini', 'Gemini', 'AQ.synthetic-input'], ['Chat', 'openai', 'OpenAI', 'sk-synthetic-input']] as const)('verifies and selects %s %s only from its popup, then removes the key field', async (kind, provider, label, key) => {
    render(<AISettingsPanel />); const dialog = await choose(kind, provider)
    expect(within(dialog).queryByLabelText(label === 'Gemini' ? 'OpenAI API key' : 'Gemini API key')).toBeNull()
    const input = within(dialog).getByLabelText(`${label} API key`)
    expect(input).toHaveAttribute('type', 'password'); fireEvent.change(input, { target: { value: key } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Verify & save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(verifyKey).toHaveBeenCalledExactlyOnceWith(provider, key)
    expect(updateSettings).toHaveBeenCalledWith(kind === 'Transcription' ? { transcription: { provider: 'gemini', model: 'gemini-3.5-transcribe' } } : { chat: { provider: 'openai', model: 'gpt-5.4-mini' } })
    expect(screen.getByLabelText(kind === 'Chat' ? 'Transcription provider' : 'Chat provider')).toHaveValue(kind === 'Chat' ? 'local' : 'gemini')
    expect(screen.queryByLabelText(`${label} API key`)).toBeNull(); expect(document.body.textContent).not.toContain(key)
  })
  it('cancels a provider choice without changing saved settings or retaining a typed key', async () => {
    render(<AISettingsPanel />); const dialog = await choose('Transcription', 'openai')
    fireEvent.change(within(dialog).getByLabelText('OpenAI API key'), { target: { value: 'sk-unsaved' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByLabelText('Transcription provider')).toHaveValue('local'); expect(updateSettings).not.toHaveBeenCalled(); expect(verifyKey).not.toHaveBeenCalled()
    expect(within(await choose('Transcription', 'openai')).getByLabelText('OpenAI API key')).toHaveValue('')
  })
  it('opens the currently selected connection on request without revealing a saved key', async () => {
    state.providers[0] = { ...state.providers[0], configured: true, verified: true }
    render(<AISettingsPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Manage Google Gemini connection for chat' }))
    const dialog = screen.getByRole('dialog', { name: 'Google Gemini connection' })
    expect(within(dialog).getByLabelText('Gemini API key')).toHaveValue(''); expect(within(dialog).getByText('Verified connection')).toBeVisible()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use Google Gemini' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); expect(verifyKey).not.toHaveBeenCalled()
  })
  it('keeps the popup available after rejected verification and clears its sensitive input', async () => {
    verifyKey.mockRejectedValue(new Error('The provider rejected this key.'))
    render(<AISettingsPanel />); const dialog = await choose('Transcription', 'gemini')
    fireEvent.change(within(dialog).getByLabelText('Gemini API key'), { target: { value: 'AQ.invalid-input' } }); fireEvent.click(within(dialog).getByRole('button', { name: 'Verify & save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('rejected this key')
    expect(within(dialog).getByLabelText('Gemini API key')).toHaveValue(''); expect(updateSettings).not.toHaveBeenCalled()
  })
  it('saves independent server concurrency limits from the transcription section', async () => {
    render(<AISettingsPanel sections={['transcription']} />)
    fireEvent.change(await screen.findByLabelText('Simultaneous transcriptions'), { target: { value: '2' } }); fireEvent.change(screen.getByLabelText('Simultaneous summaries'), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save parallelism' }))
    await waitFor(() => expect(updateSettings).toHaveBeenCalledExactlyOnceWith({ maxConcurrentTranscriptions: 2, maxConcurrentSummaries: 4 }))
    expect(screen.getByText(/no reserved resources/)).toBeVisible()
    expect(screen.getByLabelText('Simultaneous transcriptions')).toHaveAttribute('max', '4'); expect(screen.getByLabelText('Simultaneous summaries')).toHaveAttribute('max', '8')
  })
  it('offers provider confirmation to resume processing directly from transcription settings', async () => {
    state.queue = { waiting: 1, active: null, reviewPaused: true }
    appClient.ai.resumeReview = vi.fn(async () => { state.ready = true; state.reason = null; state.queue!.reviewPaused = false; return structuredClone(state) })
    render(<AISettingsPanel sections={['transcription']} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Resume processing' })); const dialog = screen.getByRole('dialog', { name: 'Resume background processing?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Resume processing' }))
    await waitFor(() => expect(appClient.ai.resumeReview).toHaveBeenCalledExactlyOnceWith(true)); expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'Process saved recordings' })).toBeEnabled()
  })
})
