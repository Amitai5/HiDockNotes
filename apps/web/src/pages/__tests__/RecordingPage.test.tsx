import { appClient, setAppClient } from '../../services/app-client'
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { RecordingPage } from '../RecordingPage'
import type { AppClient, RecordingDetail } from '../../shared/contracts'
import { DEFAULT_AI_SETTINGS, DEFAULT_MODELS, type AIState } from '../../shared/ai'
import { useAppStore } from '../../store/useAppStore'

describe('recording processing results in the Library', () => {
  let detail: RecordingDetail
  let changed: () => void
  beforeEach(() => {
    HTMLMediaElement.prototype.pause = vi.fn(function (this: HTMLMediaElement) { Object.defineProperty(this, 'paused', { configurable: true, value: true }); this.dispatchEvent(new Event('pause')) })
    HTMLMediaElement.prototype.load = vi.fn()
    detail = { recording: { id: 'recording', filename: 'call.hda', title: null, recordedAt: '2026-10-07T10:00:00Z', duration: 10, size: 200, status: 'queued', verified: true, hasAudio: false, projectId: null, summary: null }, segments: [], actionables: [], processing: { stage: 'queued', progress: 0, message: 'Waiting to process…', error: null, attempt: 0, nextAttemptAt: null } }
    setAppClient({ library: { detail: vi.fn(async () => structuredClone(detail)), onChanged: vi.fn(callback => { changed = callback; return vi.fn() }) }, projects: { list: vi.fn(async () => []) }, ai: { getState: vi.fn(async () => ({ settings: DEFAULT_AI_SETTINGS, providers: [{ provider: 'gemini', models: DEFAULT_MODELS.gemini }], ready: true, reason: null, summaryReady: true })), reprocess: vi.fn(async () => undefined) }, devicePipeline: { onState: vi.fn(() => vi.fn()) } } as unknown as AppClient)
  })
  afterEach(cleanup)
  it('shows newly generated transcript, summary and action items without reopening the page', async () => {
    render(<MemoryRouter initialEntries={['/library/recording']}><Routes><Route path="/library/:id" element={<RecordingPage />} /></Routes></MemoryRouter>)
    await screen.findByText('Waiting to process…')
    detail.recording.status = 'done'; detail.recording.summary = 'Dana will send the plan.'
    detail.segments = [{ id: 'segment', start: 1, end: 2, text: 'I will send the plan.', speakerId: null, speakerName: 'Dana' }]
    detail.actionables = [{ id: 'action', recordingId: 'recording', text: 'Send the plan', done: false, start: 1 }]
    await act(async () => changed())
    await screen.findByText('I will send the plan.')
    expect(screen.getByText('Dana will send the plan.')).toBeInTheDocument()
    expect(screen.getByText('Send the plan')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Summary' }).compareDocumentPosition(screen.getByRole('heading', { name: 'Transcript' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
  it('shows a failed summary reason while preserving the transcript and offering retry', async () => {
    detail.recording.status = 'failed'; detail.processing = { ...detail.processing!, stage: 'failed', message: 'Processing stopped.', error: 'Quota reached.' }
    detail.segments = [{ id: 'segment', start: 1, end: 2, text: 'Saved transcript text.', speakerId: null, speakerName: 'Dana' }]
    render(<MemoryRouter initialEntries={['/library/recording']}><Routes><Route path="/library/:id" element={<RecordingPage />} /></Routes></MemoryRouter>)
    await screen.findByText('Saved transcript text.')
    expect(screen.getByText('Quota reached.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Recording actions' }))
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Retry processing' })).toBeEnabled())
  })
  it('resumes a paused summary from the recording page instead of sending a connected user to setup', async () => {
    detail.processing!.mode = 'summarize'
    detail.segments = [{ id: 's', start: 1, end: 2, text: 'Already saved transcript.', speakerId: null, speakerName: 'Dana' }]
    let state: AIState = { settings: { ...DEFAULT_AI_SETTINGS, chat: { provider: 'chatgpt', model: 'gpt-6.1-sol' } }, providers: [], ready: false, reason: 'Processing is paused for this local review session.', summaryReady: false, queue: { waiting: 1, waitingSummaries: 1, waitingTranscriptions: 0, reviewPaused: true, active: null } }
    vi.mocked(appClient.ai.getState).mockImplementation(async () => structuredClone(state))
    appClient.ai.resumeReview = vi.fn(async () => {
      state = { ...state, ready: true, summaryReady: true, reason: null, queue: { ...state.queue!, reviewPaused: false } }
      detail.recording.status = 'summarizing'; detail.processing = { ...detail.processing!, stage: 'summarizing', progress: 0.3, message: 'Generating summary…' }
      changed(); return structuredClone(state)
    })
    render(<MemoryRouter initialEntries={['/library/recording']}><Routes><Route path="/library/:id" element={<RecordingPage />} /></Routes></MemoryRouter>)
    expect(await screen.findByText('Summary refresh is paused.')).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Set up AI' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Resume processing' }))
    const dialog = screen.getByRole('dialog', { name: 'Resume background processing?' })
    expect(within(dialog).getByText(/Transcript text will be sent to ChatGPT/)).toBeVisible()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep paused' }))
    expect(appClient.ai.resumeReview).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Resume processing' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Resume processing' }))
    await waitFor(() => expect(appClient.ai.resumeReview).toHaveBeenCalledExactlyOnceWith(true))
    expect(await screen.findByText('Generating summary…')).toBeVisible()
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '0.3')
    expect(screen.queryByText('Summary refresh is paused.')).toBeNull()
    expect(screen.getByText('Already saved transcript.')).toBeVisible()
  })
  it('shows overview data and saved tags above the summary, with transcript in the right pane', async () => {
    detail.recording.status = 'done'; detail.recording.title = 'Planning session'; detail.recording.summary = '## Decisions\n\nSend the plan.'; detail.recording.projectId = 'planning'
    detail.tags = ['Meeting']; detail.segments = [{ id: 's', start: 1, end: 2, text: 'A timestamped sentence.', speakerId: null, speakerName: 'Dana' }]
    vi.mocked(appClient.projects.list).mockResolvedValue([{ id: 'planning', name: 'Planning', count: 1 }])
    appClient.library.setTags = vi.fn(async (_id, tags) => { detail.tags = tags })
    render(<MemoryRouter initialEntries={['/library/recording']}><Routes><Route path="/library/:id" element={<RecordingPage />} /></Routes></MemoryRouter>)
    await screen.findByRole('heading', { name: 'Planning session' })
    expect(await screen.findByRole('link', { name: 'Planning' })).toHaveAttribute('href', '/library?project=planning')
    expect(screen.getByRole('link', { name: 'Back to Planning' })).toHaveAttribute('href', '/library?project=planning')
    expect(screen.queryByRole('combobox', { name: 'Recording project' })).toBeNull()
    expect(screen.getByText('Meeting')).toBeVisible()
    const sidebar = screen.getByRole('complementary', { name: 'Audio and transcript' })
    expect(within(sidebar).getByText('A timestamped sentence.')).toBeVisible()
    expect(within(sidebar).queryByRole('heading', { name: 'Summary' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'New tag' }), { target: { value: 'Follow up' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save tag' }))
    await waitFor(() => expect(appClient.library.setTags).toHaveBeenCalledWith('recording', ['Meeting', 'Follow up']))
    expect(await screen.findByText('Follow up')).toBeVisible()
  })
  it('does not report a user-cancelled playback request as an audio failure', async () => {
    detail.recording.hasAudio = true
    appClient.library.waveform = vi.fn(async () => ({ peaks: [], duration: 10 }))
    useAppStore.setState({ error: null })
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new DOMException('Paused while starting', 'AbortError'))
    render(<MemoryRouter initialEntries={['/library/recording']}><Routes><Route path="/library/:id" element={<RecordingPage />} /></Routes></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Play audio' }))
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled())
    expect(useAppStore.getState().error).toBeNull()
  })
  it('shows stable numbers for anonymous IDs and separates genuinely unassigned speech', async () => {
    detail.recording.status = 'done'
    detail.speakers = ['first', 'second'].map(id => ({ id, label: 'Unknown speaker', profileId: null, suggestedProfileId: null, suggestedName: null, score: null, canRemember: false }))
    detail.meeting = { meetingType: 'Planning', participants: [{ speakerId: 'first', name: 'Unknown speaker', organizer: false }] }
    detail.segments = [
      { id: 'one', start: 1, end: 2, text: 'First voice.', speakerId: 'first', speakerName: 'Unknown speaker' },
      { id: 'two', start: 3, end: 4, text: 'Second voice.', speakerId: 'second', speakerName: null },
      { id: 'three', start: 5, end: 6, text: 'Uncertain turn.', speakerId: null, speakerName: null }
    ]
    render(<MemoryRouter initialEntries={['/library/recording']}><Routes><Route path="/library/:id" element={<RecordingPage />} /></Routes></MemoryRouter>)
    const transcript = await screen.findByRole('region', { name: 'Transcript', exact: true })
    expect(within(transcript).getByText('Unknown speaker 1')).toBeVisible()
    expect(within(transcript).getByText('Unknown speaker 2')).toBeVisible()
    expect(within(transcript).getByText('Unassigned speech')).toBeVisible()
    const overview = screen.getByLabelText('Recording overview')
    expect(within(overview).getByText('Unknown speaker 1')).toBeVisible()
    expect(within(overview).queryByText('Unassigned speech')).not.toBeInTheDocument()
    expect(screen.queryByText('Unknown speaker', { exact: true })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Auto · prefers 1–3' })).toBeInTheDocument()
  })
  it('shows meeting type, supported participant names and organizer in the overview', async () => {
    detail.recording.status = 'done'
    detail.meeting = { meetingType: 'Project review', participants: [{ speakerId: null, name: 'Dana Lee', organizer: true }, { speakerId: null, name: 'Unknown speaker 2', organizer: false }] }
    render(<MemoryRouter initialEntries={['/library/recording']}><Routes><Route path="/library/:id" element={<RecordingPage />} /></Routes></MemoryRouter>)
    const overview = await screen.findByLabelText('Recording overview')
    expect(within(overview).getByText('Project review')).toBeVisible()
    expect(within(overview).getByText('Dana Lee')).toBeVisible()
    expect(within(overview).getByText('Organizer')).toBeVisible()
    expect(within(overview).getByText('Unknown speaker 2')).toBeVisible()
  })
  it('routes recording-specific resummarize and retranscribe after confirmation and does nothing when cancelled', async () => {
    detail.recording.status = 'done'; detail.recording.hasAudio = true
    detail.segments = [{ id: 's', start: 1, end: 2, text: 'Saved words', speakerId: null, speakerName: null }]
    appClient.library.waveform = vi.fn(async () => ({ peaks: [], duration: 10 }))
    render(<MemoryRouter initialEntries={['/library/recording']}><Routes><Route path="/library/:id" element={<RecordingPage />} /></Routes></MemoryRouter>)
    const trigger = await screen.findByRole('button', { name: 'Recording actions' })
    expect(screen.queryByRole('button', { name: 'Resummarize' })).toBeNull()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Resummarize' })); fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(appClient.ai.reprocess).not.toHaveBeenCalled()
    fireEvent.click(trigger); fireEvent.click(screen.getByRole('menuitem', { name: 'Resummarize' })); fireEvent.click(screen.getByRole('button', { name: 'Generate summary' }))
    await waitFor(() => expect(appClient.ai.reprocess).toHaveBeenCalledWith('recording', 'summarize'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(trigger); fireEvent.click(screen.getByRole('menuitem', { name: 'Retranscribe' }))
    expect(screen.getByText(/A new summary, participants, tags and action items follow automatically after you apply it/)).toBeVisible()
    appClient.library.setSpeakerCount = vi.fn(async () => undefined)
    expect(screen.getByRole('button', { name: 'Retranscribe and summarize' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Speakers for retranscription'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Retranscribe and summarize' }))
    await waitFor(() => expect(appClient.ai.reprocess).toHaveBeenCalledWith('recording', 'transcribe'))
    expect(appClient.library.setSpeakerCount).toHaveBeenCalledWith('recording', 3)
  })
  it('ignores a stale detail rejection after successful deletion and returns to Library without an error toast', async () => {
    detail.recording.status = 'done'; useAppStore.setState({ error: null })
    let rejectOld: ((error: Error) => void) | undefined
    appClient.library.deletionInfo = vi.fn(async () => ({ deviceRequired: false, deviceDone: false, allowed: true, reason: null }))
    appClient.library.delete = vi.fn(async () => { rejectOld?.(new Error('Recording was not found.')) })
    render(<MemoryRouter initialEntries={['/library/recording']}><Routes><Route path="/library/:id" element={<RecordingPage />} /><Route path="/library" element={<h1>Library</h1>} /></Routes></MemoryRouter>)
    const trigger = await screen.findByRole('button', { name: 'Recording actions' })
    vi.mocked(appClient.library.detail).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject }))
    await act(async () => changed())
    fireEvent.click(trigger); fireEvent.click(screen.getByRole('menuitem', { name: 'Delete recording' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete recording' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Delete recording' }))
    await screen.findByRole('heading', { name: 'Library' })
    expect(appClient.library.delete).toHaveBeenCalledWith('recording', true)
    expect(useAppStore.getState().error).toBeNull()
  })
  it('stops the previous recording and resets position, rate and play state on navigation', async () => {
    detail.recording.hasAudio = true; detail.recording.status = 'done'
    appClient.library.waveform = vi.fn(async () => ({ peaks: [], duration: 10 }))
    appClient.library.detail = vi.fn(async id => ({ ...structuredClone(detail), recording: { ...detail.recording, id, title: id } }))
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async function (this: HTMLMediaElement) {
      Object.defineProperty(this, 'paused', { configurable: true, value: false }); this.dispatchEvent(new Event('playing'))
    })
    render(<MemoryRouter initialEntries={['/library/first']}><Link to="/library/second">Open second recording</Link><Routes><Route path="/library/:id" element={<RecordingPage />} /></Routes></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Play audio' }))
    await screen.findByRole('button', { name: 'Pause audio' })
    const oldAudio = document.querySelector('audio')!
    oldAudio.currentTime = 3; fireEvent.timeUpdate(oldAudio)
    fireEvent.change(screen.getByLabelText('Playback speed'), { target: { value: '1.5' } })
    fireEvent.click(screen.getByText('Open second recording'))
    await screen.findByRole('heading', { name: 'second' })
    const newAudio = document.querySelector('audio')!
    expect(newAudio).not.toBe(oldAudio)
    expect(oldAudio.paused).toBe(true)
    expect(oldAudio).not.toHaveAttribute('src')
    expect(screen.getByRole('slider', { name: 'Seek in recording' })).toHaveAttribute('aria-valuenow', '0')
    expect(screen.getByLabelText('Playback speed')).toHaveValue('1')
    fireEvent.playing(oldAudio); fireEvent.timeUpdate(oldAudio)
    expect(screen.getByRole('button', { name: 'Play audio' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Play audio' }))
    await screen.findByRole('button', { name: 'Pause audio' })
    expect(play).toHaveBeenCalledTimes(2)
    newAudio.currentTime = 2; fireEvent.timeUpdate(newAudio)
    expect(screen.getByRole('slider', { name: 'Seek in recording' })).toHaveAttribute('aria-valuenow', '2')
  })
  it('ignores a previous recording\'s late play failure after switching while buffering', async () => {
    detail.recording.hasAudio = true; useAppStore.setState({ error: null })
    appClient.library.waveform = vi.fn(async () => ({ peaks: [], duration: 10 }))
    let rejectOld: ((error: Error) => void) | undefined
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject }))
    render(<MemoryRouter initialEntries={['/library/first']}><Link to="/library/second">Open second recording</Link><Routes><Route path="/library/:id" element={<RecordingPage />} /></Routes></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Play audio' }))
    expect(screen.getByRole('button', { name: 'Cancel playback' })).toBeVisible()
    fireEvent.click(screen.getByText('Open second recording'))
    await screen.findByRole('button', { name: 'Play audio' })
    await act(async () => rejectOld?.(new Error('Old audio disconnected')))
    expect(useAppStore.getState().error).toBeNull()
    expect(screen.getByRole('button', { name: 'Play audio' })).toBeVisible()
  })
})
