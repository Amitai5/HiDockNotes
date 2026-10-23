import { appClient, setAppClient } from '../../services/app-client'
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AssistantPage } from '../AssistantPage'
import { DEFAULT_AI_SETTINGS, type AIState, type AssistantAnswer } from '../../shared/ai'
import type { ConversationDetail } from '../../shared/conversations'
import type { AppClient, RecordingDetail } from '../../shared/contracts'

const ask = vi.fn(), scroll = vi.fn()
let state: AIState
beforeEach(() => {
  ask.mockReset().mockResolvedValue({ text: 'The team agreed to send the plan.', citations: [{ number: 1, recordingId: 'source', title: 'Team call', start: 12, excerpt: 'Send the plan.' }] })
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scroll })
  state = { settings: structuredClone(DEFAULT_AI_SETTINGS), providers: [{ provider: 'gemini', configured: true, verified: true, verifiedAt: null, models: [], offline: false }], ready: true, reason: null }
  setAppClient({ app: { copyText: vi.fn(async () => undefined) }, ai: { getState: vi.fn(async () => state) }, projects: { list: vi.fn(async () => [{ id: 'project', name: 'Team', count: 2 }]) }, library: { onChanged: vi.fn(() => vi.fn()), detail: vi.fn(async id => ({ recording: { id, filename: 'source.hda', title: id === 'source' ? 'Team call' : 'Client call', recordedAt: '2026-10-13T10:00:00Z', duration: 60, size: 200, status: 'done', verified: true, hasAudio: false, projectId: null, summary: '## Decision\n\nShare the approved plan.' }, segments: Array.from({ length: 30 }, (_, index) => ({ id: 'segment-' + index, start: index * 2, end: index * 2 + 2, text: index === 6 ? 'Send the plan.' : 'Context sentence ' + index, speakerId: null, speakerName: 'Dana' })), actionables: [] } as RecordingDetail)) }, assistant: { ask } } as unknown as AppClient)
  const chats = new Map<string, ConversationDetail>()
  let selected: string | null = null
  appClient.conversations = {
    current: vi.fn(async () => selected ? structuredClone(chats.get(selected)!) : null),
    create: vi.fn(async projectId => {
      const id = 'chat-' + chats.size, date = '2026-10-21T10:00:00Z'
      const chat: ConversationDetail = { conversation: { id, title: 'New chat', projectId, projectName: projectId ? 'Team' : null, createdAt: date, updatedAt: date, version: 0, messageCount: 0, responding: false, draft: '' }, messages: [], hasEarlier: false }
      chats.set(id, chat); selected = id; return structuredClone(chat)
    }),
    get: vi.fn(async id => structuredClone(chats.get(id)!)),
    select: vi.fn(async id => { selected = id; return structuredClone(chats.get(id)!) }),
    list: vi.fn(async query => [...chats.values()].filter(chat => !query || chat.conversation.title.includes(query)).map(chat => chat.conversation)),
    rename: vi.fn(async (id, title) => { const chat = chats.get(id)!; chat.conversation.title = title; return structuredClone(chat) }),
    delete: vi.fn(async id => { chats.delete(id); if (selected === id) selected = null }), cancel: vi.fn(async () => undefined), onChanged: vi.fn(() => vi.fn()),
    send: vi.fn(async (id, question) => {
      const chat = chats.get(id)!, answer = await ask(question, chat.conversation.projectId, chat.messages.slice(-6).map(message => ({ role: message.role, content: message.content }))) as AssistantAnswer
      if (!chat.conversation.version) chat.conversation.title = question
      chat.messages.push({ id: id + '-question-' + chat.messages.length, ordinal: chat.messages.length, role: 'user', content: question, citations: [], createdAt: chat.conversation.createdAt })
      chat.messages.push({ id: id + '-answer-' + chat.messages.length, ordinal: chat.messages.length, role: 'assistant', content: answer.text, citations: answer.citations, createdAt: chat.conversation.createdAt })
      chat.conversation.version++; chat.conversation.messageCount = chat.messages.length
      return structuredClone(chat)
    })
  }
})
afterEach(cleanup)
function show(): ReturnType<typeof render> { return render(<MemoryRouter><AssistantPage /></MemoryRouter>) }
describe('Assistant conversation and bottom composer', () => {
  it('sends from the composer with Enter and opens a timestamped source beside the unchanged chat', async () => {
    const { container } = show()
    await waitFor(() => expect(screen.getByLabelText('Ask about your recordings')).toBeEnabled())
    fireEvent.change(screen.getByLabelText('Ask about your recordings'), { target: { value: 'What did we decide?' } })
    fireEvent.keyDown(screen.getByLabelText('Ask about your recordings'), { key: 'Enter' })
    expect(await screen.findByText('The team agreed to send the plan.')).toBeVisible()
    expect(ask).toHaveBeenCalledWith('What did we decide?', null, [])
    const source = screen.getByRole('button', { name: 'Review source 1: Team call' })
    fireEvent.change(screen.getByLabelText('Ask about your recordings'), { target: { value: 'A follow-up draft' } })
    fireEvent.click(source)
    const panel = await screen.findByRole('complementary', { name: 'Recording source' })
    expect(await within(panel).findByRole('heading', { name: 'Team call' })).toBeVisible()
    expect(appClient.library.detail).toHaveBeenCalledWith('source')
    expect(within(panel).getByRole('region', { name: 'Cited passage' })).toHaveTextContent('Send the plan.')
    expect(within(panel).getByRole('button', { name: 'Play source from 0:12' })).toBeVisible()
    expect(source).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('The team agreed to send the plan.')).toBeVisible()
    expect(screen.getByLabelText('Ask about your recordings')).toHaveValue('A follow-up draft')
    fireEvent.click(within(panel).getByRole('tab', { name: 'Summary' }))
    expect(within(panel).getByRole('heading', { name: 'Decision' })).toBeVisible()
    fireEvent.click(within(panel).getByRole('button', { name: 'Close source panel' }))
    expect(screen.queryByRole('complementary', { name: 'Recording source' })).toBeNull()
    expect(source).toHaveFocus()
    expect(screen.getByLabelText('Ask about your recordings')).toHaveValue('A follow-up draft')
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
  it('renders Markdown answers and copies the original answer through the main process', async () => {
    const text = '## Decision\n\nUse **lane change** in the mockup.\n\n- Keep the wording consistent.'
    ask.mockResolvedValue({ text, citations: [] })
    show(); await waitFor(() => expect(screen.getByLabelText('Ask about your recordings')).toBeEnabled())
    fireEvent.change(screen.getByLabelText('Ask about your recordings'), { target: { value: 'What should I change?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(await screen.findByRole('heading', { name: 'Decision' })).toBeVisible()
    expect(screen.getByText('lane change').tagName).toBe('STRONG')
    fireEvent.click(screen.getByRole('button', { name: 'Copy answer' }))
    await waitFor(() => expect(appClient.app.copyText).toHaveBeenCalledWith(text))
    expect(await screen.findByRole('button', { name: 'Answer copied' })).toBeVisible()
  })
  it('offers a stop control and lets the user draft while an answer is pending', async () => {
    let finish: (value: { text: string; citations: [] }) => void = () => undefined
    ask.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const { container } = show()
    await waitFor(() => expect(screen.getByLabelText('Ask about your recordings')).toBeEnabled())
    fireEvent.change(screen.getByLabelText('Ask about your recordings'), { target: { value: 'First question' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Reviewing your recordings…')
    expect(container.querySelector('.assistant-send')?.querySelectorAll('svg')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Stop answer' })).toBeEnabled()
    fireEvent.change(screen.getByLabelText('Ask about your recordings'), { target: { value: 'Next question draft' } })
    await act(async () => finish({ text: 'Answer ready.', citations: [] }))
    expect(screen.getByLabelText('Ask about your recordings')).toHaveValue('Next question draft')
    expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled()
    expect(screen.queryByRole('status')).toBeNull()
  })
  it('preserves a new question draft when the preceding answer fails', async () => {
    let fail!: (error: Error) => void
    ask.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject }))
    show()
    await waitFor(() => expect(screen.getByLabelText('Ask about your recordings')).toBeEnabled())
    fireEvent.change(screen.getByLabelText('Ask about your recordings'), { target: { value: 'First question' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await screen.findByRole('button', { name: 'Stop answer' })
    fireEvent.change(screen.getByLabelText('Ask about your recordings'), { target: { value: 'Next question draft' } })
    await act(async () => fail(new Error('Connection failed.')))
    expect(screen.getByLabelText('Ask about your recordings')).toHaveValue('Next question draft')
    expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled()
  })
  it('continues the conversation while a source panel is open and preserves answer history', async () => {
    show(); await waitFor(() => expect(screen.getByLabelText('Ask about your recordings')).toBeEnabled())
    fireEvent.change(screen.getByLabelText('Ask about your recordings'), { target: { value: 'First question' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Review source 1: Team call' }))
    await screen.findByRole('heading', { name: 'Team call' })
    ask.mockResolvedValueOnce({ text: 'The owner is Dana.', citations: [] })
    fireEvent.change(screen.getByLabelText('Ask about your recordings'), { target: { value: 'Who owns it?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(await screen.findByText('The owner is Dana.')).toBeVisible()
    expect(screen.getByRole('complementary', { name: 'Recording source' })).toBeVisible()
    expect(ask).toHaveBeenLastCalledWith('Who owns it?', null, [{ role: 'user', content: 'First question' }, { role: 'assistant', content: 'The team agreed to send the plan.' }])
  })
  it('does not replace a newly opened source with the old source response', async () => {
    ask.mockResolvedValue({ text: 'See both meetings.', citations: [{ number: 1, recordingId: 'source', title: 'Team call', start: 12, excerpt: 'First passage.' }, { number: 2, recordingId: 'other', title: 'Client call', start: 20, excerpt: 'Second passage.' }] })
    let finish: (value: RecordingDetail) => void = () => undefined
    vi.mocked(appClient.library.detail).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    show(); await waitFor(() => expect(screen.getByLabelText('Ask about your recordings')).toBeEnabled())
    fireEvent.change(screen.getByLabelText('Ask about your recordings'), { target: { value: 'Compare the calls' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Review source 1: Team call' }))
    fireEvent.click(screen.getByRole('button', { name: 'Review source 2: Client call' }))
    const panel = screen.getByRole('complementary', { name: 'Recording source' })
    await within(panel).findByRole('tab', { name: 'Transcript' })
    const old = await appClient.library.detail('source')
    await act(async () => finish(old))
    expect(within(panel).getByRole('heading', { name: 'Client call' })).toBeVisible()
    expect(within(panel).queryByRole('heading', { name: 'Team call' })).toBeNull()
  })
  it('shows a recoverable source error without losing the answer or cited passage', async () => {
    vi.mocked(appClient.library.detail).mockRejectedValueOnce(new Error('Recording not found.'))
    show(); await waitFor(() => expect(screen.getByLabelText('Ask about your recordings')).toBeEnabled())
    fireEvent.change(screen.getByLabelText('Ask about your recordings'), { target: { value: 'Find the decision' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Review source 1: Team call' }))
    const panel = screen.getByRole('complementary', { name: 'Recording source' })
    expect(await within(panel).findByRole('alert')).toHaveTextContent('could not be loaded')
    expect(within(panel).getByRole('region', { name: 'Cited passage' })).toHaveTextContent('Send the plan.')
    fireEvent.click(within(panel).getByRole('button', { name: 'Try again' }))
    expect(await within(panel).findByRole('tab', { name: 'Transcript' })).toBeVisible()
    expect(screen.getByText('The team agreed to send the plan.')).toBeVisible()
  })
  it('immediately reflects the cited timestamp when source audio metadata arrives', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)
    const original = vi.mocked(appClient.library.detail).getMockImplementation()!
    vi.mocked(appClient.library.detail).mockImplementation(async id => { const value = await original(id); return { ...value, recording: { ...value.recording, hasAudio: true } } })
    show(); await waitFor(() => expect(screen.getByLabelText('Ask about your recordings')).toBeEnabled())
    fireEvent.change(screen.getByLabelText('Ask about your recordings'), { target: { value: 'Find the passage' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Review source 1: Team call' }))
    const slider = await screen.findByRole('slider', { name: 'Seek source recording' })
    const audio = document.querySelector('.source-audio-player audio')!
    Object.defineProperty(audio, 'duration', { configurable: true, value: 60 })
    fireEvent.loadedMetadata(audio)
    expect((audio as HTMLAudioElement).currentTime).toBe(12)
    expect(slider).toHaveValue('12')
  })
  it('reopens a saved conversation after the Assistant page is remounted', async () => {
    const first = show(); await waitFor(() => expect(screen.getByLabelText('Ask about your recordings')).toBeEnabled())
    fireEvent.change(screen.getByLabelText('Ask about your recordings'), { target: { value: 'Remember this discussion' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await screen.findByText('The team agreed to send the plan.')
    first.unmount(); show()
    expect(await screen.findByText('The team agreed to send the plan.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Review source 1: Team call' })).toBeVisible()
    expect(ask).toHaveBeenCalledOnce()
  })
  it('starts a separate chat and reopens the old one from history', async () => {
    show(); await waitFor(() => expect(screen.getByLabelText('Ask about your recordings')).toBeEnabled())
    fireEvent.change(screen.getByLabelText('Ask about your recordings'), { target: { value: 'Saved planning discussion' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await screen.findByText('The team agreed to send the plan.')
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }))
    expect(screen.queryByText('The team agreed to send the plan.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Chat history' }))
    const dialog = screen.getByRole('dialog', { name: 'Saved chats' })
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Open chat: Saved planning discussion' }))
    expect(await screen.findByText('The team agreed to send the plan.')).toBeVisible()
    expect(ask).toHaveBeenCalledOnce()
  })
})
