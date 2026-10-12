// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AISettingsPanel } from '../AISettingsPanel'
import type { ElectronAPI } from '../../shared/contracts'
import type { AISettings, AIState } from '../../shared/ai'
import { DEFAULT_AI_SETTINGS, DEFAULT_MODELS } from '../../shared/ai'

describe('AI provider setup', () => {
  let state: AIState
  const verifyKey = vi.fn(), updateSettings = vi.fn()
  beforeEach(() => {
    state = { settings: structuredClone(DEFAULT_AI_SETTINGS), providers: (['gemini', 'openai'] as const).map(provider => ({ provider, configured: false, verified: false, verifiedAt: null, models: DEFAULT_MODELS[provider], offline: true })), ready: false, reason: 'Verify Gemini in Settings to start transcription and summaries.' }
    verifyKey.mockReset().mockImplementation(async (provider: string) => { state.providers = state.providers.map(item => item.provider === provider ? { ...item, configured: true, verified: true, offline: false } : item); state.ready = true; return structuredClone(state) })
    updateSettings.mockReset().mockImplementation(async (patch: Partial<AISettings>) => { state.settings = { ...state.settings, ...patch }; return structuredClone(state) })
    window.electronAPI = { ai: { getState: vi.fn(async () => state), verifyKey, updateSettings } } as unknown as ElectronAPI
  })
  afterEach(cleanup)
  it('verifies an AQ key and clears the password input after encrypted saving', async () => {
    render(<AISettingsPanel />)
    await screen.findByLabelText('Transcription provider')
    fireEvent.change(screen.getByLabelText('Gemini API key'), { target: { value: 'AQ.synthetic-input' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Verify & save' })[0])
    await screen.findByText('Verified with a live models request. Your key is encrypted.')
    expect(verifyKey).toHaveBeenCalledWith('gemini', 'AQ.synthetic-input')
    expect(screen.getByLabelText('Gemini API key')).toHaveValue('')
  })
  it('keeps transcription and chat choices independent', async () => {
    render(<AISettingsPanel />)
    await screen.findByLabelText('Transcription provider')
    fireEvent.change(screen.getByLabelText('Transcription provider'), { target: { value: 'openai' } })
    await waitFor(() => expect(screen.getByLabelText('Transcription model')).toHaveValue('whisper-1'))
    expect(screen.getByLabelText('Chat provider')).toHaveValue('gemini')
    expect(updateSettings).toHaveBeenCalledWith({ transcription: { provider: 'openai', model: 'whisper-1' } })
  })
  it('selects local Whisper by default with no key field or local chat option', async () => {
    render(<AISettingsPanel />)
    expect(await screen.findByLabelText('Transcription provider')).toHaveValue('local')
    expect(screen.getByLabelText('Transcription model')).toHaveValue('whisper-base')
    expect(screen.getByText(/No API key needed/)).toBeVisible()
    expect(screen.getByLabelText('Chat provider').querySelector('option[value="local"]')).toBeNull()
    fireEvent.change(screen.getByLabelText('Transcription model'), { target: { value: 'whisper-small' } })
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ transcription: { provider: 'local', model: 'whisper-small' } }))
  })
  it('shows verification failure clearly and never claims a key was saved', async () => {
    verifyKey.mockRejectedValue(new Error('The provider rejected this key.'))
    render(<AISettingsPanel />)
    fireEvent.change(screen.getByLabelText('Gemini API key'), { target: { value: 'AQ.invalid-input' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Verify & save' })[0])
    await screen.findByRole('alert')
    expect(screen.getByRole('alert')).toHaveTextContent('rejected this key')
    expect(screen.queryByText('Verified')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Gemini API key')).toHaveValue('')
  })
})
