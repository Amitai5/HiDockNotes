// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AISettingsPanel } from '../AISettingsPanel'
import { ChatGPTAccountPanel } from '../ChatGPTAccountPanel'
import { DEFAULT_AI_SETTINGS, DEFAULT_CHATGPT_MODELS, DEFAULT_MODELS, type AIState, type ChatGPTState } from '../../shared/ai'
import type { ElectronAPI } from '../../shared/contracts'

describe('subscription settings and consent UI', () => {
  let state: AIState
  const signIn = vi.fn(), acknowledgeWelcome = vi.fn(), manageUsage = vi.fn(), resume = vi.fn()
  beforeEach(() => {
    const chatgpt: ChatGPTState = { profiles: [], activeProfileId: null, connected: false, planEnabled: false, signingIn: false, error: null, welcomePending: false, models: DEFAULT_CHATGPT_MODELS, offline: true, usageBlocked: false }
    state = { settings: structuredClone(DEFAULT_AI_SETTINGS), providers: (['gemini', 'openai'] as const).map(provider => ({ provider, configured: false, verified: false, verifiedAt: null, models: DEFAULT_MODELS[provider], offline: true })), ready: false, reason: 'Verify Gemini.', chatgpt }
    signIn.mockReset().mockImplementation(async () => { state.chatgpt!.signingIn = true; return structuredClone(state) })
    acknowledgeWelcome.mockReset().mockImplementation(async () => { state.chatgpt!.welcomePending = false; return structuredClone(state) })
    manageUsage.mockReset().mockResolvedValue(undefined)
    resume.mockReset().mockImplementation(async () => { state.chatgpt!.usageBlocked = false; state.chatgpt!.error = null; return structuredClone(state) })
    window.electronAPI = { ai: { getState: vi.fn(async () => structuredClone(state)), chatgpt: { signIn, acknowledgeWelcome, manageUsage, resume } } } as unknown as ElectronAPI
  })
  afterEach(cleanup)
  function Harness(): JSX.Element { const [value, setValue] = useState(state); return <ChatGPTAccountPanel state={value} accept={setValue} /> }
  it('starts browser sign-in without an API key and shows the waiting state', async () => {
    render(<AISettingsPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Continue with ChatGPT' }))
    await screen.findByText('Complete sign-in in your browser…')
    expect(signIn).toHaveBeenCalledWith(null)
    expect(screen.getByText(/ChatGPT plan usage does not support audio transcription/)).toBeInTheDocument()
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
})
