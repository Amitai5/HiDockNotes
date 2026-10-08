// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AssistantPage } from '../AssistantPage'
import { DEFAULT_AI_SETTINGS, type AIState } from '../../shared/ai'
import type { ElectronAPI } from '../../shared/contracts'

const ask = vi.fn(), scroll = vi.fn()
let state: AIState
beforeEach(() => {
  ask.mockReset().mockResolvedValue({ text: 'The team agreed to send the plan.', citations: [{ number: 1, recordingId: 'source', title: 'Team call', start: 12, excerpt: 'Send the plan.' }] })
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scroll })
  state = { settings: structuredClone(DEFAULT_AI_SETTINGS), providers: [{ provider: 'gemini', configured: true, verified: true, verifiedAt: null, models: [], offline: false }], ready: true, reason: null }
  window.electronAPI = { ai: { getState: vi.fn(async () => state) }, projects: { list: vi.fn(async () => [{ id: 'project', name: 'Team', count: 2 }]) }, library: { onChanged: vi.fn(() => vi.fn()) }, assistant: { ask } } as unknown as ElectronAPI
})
afterEach(cleanup)
function show(): ReturnType<typeof render> { return render(<MemoryRouter><AssistantPage /></MemoryRouter>) }
describe('Assistant conversation and bottom composer', () => {
  it('sends from the composer with Enter and preserves timestamped source links', async () => {
    const { container } = show()
    await waitFor(() => expect(screen.getByLabelText('Ask about your recordings')).toBeEnabled())
    fireEvent.change(screen.getByLabelText('Ask about your recordings'), { target: { value: 'What did we decide?' } })
    fireEvent.keyDown(screen.getByLabelText('Ask about your recordings'), { key: 'Enter' })
    expect(await screen.findByText('The team agreed to send the plan.')).toBeVisible()
    expect(ask).toHaveBeenCalledWith('What did we decide?', null, [])
    expect(screen.getByRole('link', { name: /Team call/ })).toHaveAttribute('href', '/library/source?t=12')
    expect(container.querySelector('.assistant-page')?.lastElementChild).toHaveClass('assistant-composer')
    expect(screen.getByRole('log', { name: 'Conversation' })).not.toContainElement(screen.getByLabelText('Ask about your recordings'))
  })
  it('keeps Shift+Enter and IME confirmation available for composing instead of sending', async () => {
    show()
    await waitFor(() => expect(screen.getByLabelText('Ask about your recordings')).toBeEnabled())
    fireEvent.change(screen.getByLabelText('Ask about your recordings'), { target: { value: 'A multiline question' } })
    fireEvent.keyDown(screen.getByLabelText('Ask about your recordings'), { key: 'Enter', shiftKey: true })
    fireEvent.keyDown(screen.getByLabelText('Ask about your recordings'), { key: 'Enter', isComposing: true })
    expect(ask).not.toHaveBeenCalled()
  })
  it('retains the question after a failed request and sends the selected project scope', async () => {
    ask.mockRejectedValue(new Error('Request failed.'))
    show()
    await screen.findByRole('option', { name: 'Team' })
    fireEvent.change(screen.getByLabelText('Assistant project'), { target: { value: 'project' } })
    fireEvent.change(screen.getByLabelText('Ask about your recordings'), { target: { value: 'Find the next step' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await waitFor(() => expect(ask).toHaveBeenCalledWith('Find the next step', 'project', []))
    await waitFor(() => expect(screen.getByLabelText('Ask about your recordings')).toHaveValue('Find the next step'))
  })
  it('disables sending until a chat provider is connected', async () => {
    state.providers = []
    show()
    expect(await screen.findByRole('link', { name: 'Set up AI' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled()
    expect(ask).not.toHaveBeenCalled()
  })
})
