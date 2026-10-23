import { setAppClient } from '../../services/app-client'
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { AISettingsPanel } from '../AISettingsPanel'
import { ChatGPTAccountPanel } from '../ChatGPTAccountPanel'
import { DEFAULT_AI_SETTINGS, DEFAULT_CHATGPT_MODELS, DEFAULT_MODELS, type AIState, type ChatGPTState } from '../../shared/ai'
import type { AppClient } from '../../shared/contracts'

describe('subscription settings and consent UI', () => {
  let state: AIState
  const signIn = vi.fn(), completeCallback = vi.fn(), cancelSignIn = vi.fn(), acknowledgeWelcome = vi.fn(), manageUsage = vi.fn(), resume = vi.fn(), select = vi.fn(), remove = vi.fn()
  beforeEach(() => {
    const chatgpt: ChatGPTState = { profiles: [], activeProfileId: null, connected: false, planEnabled: false, signingIn: false, error: null, welcomePending: false, models: DEFAULT_CHATGPT_MODELS, offline: true, usageBlocked: false }
    state = { settings: structuredClone(DEFAULT_AI_SETTINGS), providers: (['gemini', 'openai'] as const).map(provider => ({ provider, configured: false, verified: false, verifiedAt: null, models: DEFAULT_MODELS[provider], offline: true })), ready: false, reason: 'Verify Gemini.', chatgpt }
    signIn.mockReset().mockImplementation(async () => { state.chatgpt!.signingIn = true; return structuredClone(state) })
    completeCallback.mockReset().mockImplementation(async () => { state.chatgpt = { ...state.chatgpt!, signingIn: false, connected: true, planEnabled: true }; return structuredClone(state) })
    cancelSignIn.mockReset().mockImplementation(async () => { state.chatgpt!.signingIn = false; return structuredClone(state) })
    acknowledgeWelcome.mockReset().mockImplementation(async () => { state.chatgpt!.welcomePending = false; return structuredClone(state) })
    manageUsage.mockReset().mockResolvedValue(undefined)
    resume.mockReset().mockImplementation(async () => { state.chatgpt!.usageBlocked = false; state.chatgpt!.error = null; return structuredClone(state) })
    select.mockReset().mockImplementation(async (id: string) => { state.chatgpt!.activeProfileId = id; return structuredClone(state) })
    remove.mockReset().mockImplementation(async (id: string) => { state.chatgpt!.profiles = state.chatgpt!.profiles.filter(profile => profile.id !== id); if (state.chatgpt!.activeProfileId === id) state.chatgpt!.activeProfileId = state.chatgpt!.profiles[0]?.id ?? null; return { state: structuredClone(state), message: null } })
    setAppClient({ ai: { getState: vi.fn(async () => structuredClone(state)), chatgpt: { signIn, completeCallback, cancelSignIn, acknowledgeWelcome, manageUsage, resume, select, remove } } } as unknown as AppClient)
  })
  afterEach(cleanup)
  function Harness(): JSX.Element { const [value, setValue] = useState(state); return <ChatGPTAccountPanel state={value} accept={setValue} /> }
  it('starts browser sign-in without an API key and shows the waiting state', async () => {
    render(<AISettingsPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with ChatGPT' }))
    await screen.findByText('Complete sign-in in your browser…')
    expect(signIn).toHaveBeenCalledWith(null)
    expect(screen.queryByLabelText('ChatGPT API key')).toBeNull()
    expect(screen.getByText(/No SSH tunnel is needed/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Finish connection' })).toBeDisabled()
  })
  it('finishes remote sign-in with the pasted callback and clears the sensitive field', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Continue with ChatGPT' }))
    const field = await screen.findByLabelText('Callback URL')
    expect(field).toHaveAttribute('type', 'password')
    fireEvent.change(field, { target: { value: '  http://127.0.0.1:1455/auth/callback?code=example&state=example  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Finish connection' }))
    await screen.findByText('Connected')
    expect(completeCallback).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:1455/auth/callback?code=example&state=example')
    expect(screen.queryByLabelText('Callback URL')).toBeNull()
    expect(screen.queryByText(/SSH tunnel from this computer/)).toBeNull()
  })
  it('keeps the pending form available after a rejected callback', async () => {
    completeCallback.mockRejectedValueOnce(new Error('The sign-in callback did not match this attempt.'))
    state.chatgpt!.signingIn = true; render(<Harness />)
    fireEvent.change(screen.getByLabelText('Callback URL'), { target: { value: 'http://127.0.0.1:1455/auth/callback?code=example&state=wrong' } })
    fireEvent.click(screen.getByRole('button', { name: 'Finish connection' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('did not match this attempt')
    expect(screen.getByRole('button', { name: 'Finish connection' })).toBeEnabled()
    expect(screen.getByLabelText('Callback URL')).toBeVisible()
  })
  it('discards the callback when sign-in is cancelled', async () => {
    state.chatgpt!.signingIn = true; render(<Harness />)
    fireEvent.change(screen.getByLabelText('Callback URL'), { target: { value: 'private callback' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel sign-in' }))
    await waitFor(() => expect(screen.queryByLabelText('Callback URL')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Continue with ChatGPT' }))
    expect(await screen.findByLabelText('Callback URL')).toHaveValue('')
  })
  it('offers the subscription for chat only and keeps local and API transcription choices visible', async () => {
    render(<AISettingsPanel />)
    await screen.findByLabelText('Chat provider')
    const chat = screen.getByLabelText('Chat provider') as HTMLSelectElement, transcription = screen.getByLabelText('Transcription provider') as HTMLSelectElement
    expect(Array.from(chat.options, option => option.value)).toContain('chatgpt')
    expect(Array.from(transcription.options, option => option.value)).not.toContain('chatgpt')
    expect(transcription.value).toBe('local')
    expect(Array.from(transcription.options, option => option.value)).toEqual(['local', 'gemini', 'openai'])
  })
  it('renders the first-use confirmation outside drag regions and persists its dismissal', async () => {
    state.chatgpt = { ...state.chatgpt!, welcomePending: true, planEnabled: true, connected: true }
    render(<div data-drag-region style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}><Harness /></div>)
    const dialog = await screen.findByRole('dialog')
    expect(dialog.closest('[data-drag-region]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(acknowledgeWelcome).toHaveBeenCalledTimes(1)
  })
  it('links usage management and requires explicit resumption after a plan pause', async () => {
    state.chatgpt = { ...state.chatgpt!, usageBlocked: true, error: 'ChatGPT usage limit reached. Manage usage.' }
    render(<Harness />)
    expect(screen.getByRole('alert')).toHaveTextContent('usage limit')
    fireEvent.click(screen.getByRole('button', { name: 'Manage usage' }))
    expect(manageUsage).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Retry plan requests' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(resume).toHaveBeenCalledTimes(1)
  })
  function accounts(): void {
    state.chatgpt!.profiles = [{ id: 'one', label: 'Connection 1', email: 'same@example.com', name: null, connected: true, planEnabled: true, models: DEFAULT_CHATGPT_MODELS, offline: false }, { id: 'two', label: 'Connection 2', email: 'same@example.com', name: null, connected: false, planEnabled: false, models: DEFAULT_CHATGPT_MODELS, offline: true }]
    state.chatgpt!.activeProfileId = 'two'
  }
  it('removes a signed-out account from the dropdown only after confirmation', async () => {
    accounts(); render(<Harness />)
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Remove account' }))
    const dialog = screen.getByRole('dialog', { name: 'Remove saved ChatGPT account?' })
    expect(within(dialog).getByText('Connection 2 · same@example.com')).toBeVisible()
    expect(within(dialog).getByText(/does not delete your ChatGPT account or your recordings/)).toBeVisible()
    expect(remove).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove account' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(remove).toHaveBeenCalledExactlyOnceWith('two', true)
    expect(screen.getByLabelText('ChatGPT account')).toHaveValue('one')
    expect(screen.queryByRole('option', { name: /Connection 2/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeVisible()
  })
  it('keeps the selected account when the removal popup is cancelled', () => {
    accounts(); render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove account' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(remove).not.toHaveBeenCalled()
    expect(screen.getByLabelText('ChatGPT account')).toHaveValue('two')
    expect(screen.getAllByRole('option')).toHaveLength(2)
  })
  it('offers removal for connected accounts too and keeps the popup open on failure', async () => {
    accounts(); state.chatgpt!.activeProfileId = 'one'
    remove.mockRejectedValueOnce(new Error('Account storage is unavailable.'))
    render(<Harness />)
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Remove account' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove account' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Account storage is unavailable.')
    expect(screen.getByLabelText('ChatGPT account')).toHaveValue('one')
    expect(within(dialog).getByRole('button', { name: 'Remove account' })).toBeEnabled()
  })
})
