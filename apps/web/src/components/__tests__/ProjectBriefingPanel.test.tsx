// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ProjectBriefingPanel from '../ProjectBriefingPanel'
import { setAppClient } from '../../services/app-client'
import type { AppClient } from '../../shared/contracts'
import type { ProjectBriefingState } from '../../shared/project-briefing'

const get = vi.fn(), generate = vi.fn(), cancel = vi.fn()
let state: ProjectBriefingState, changed: (() => void)[]
function generated(): NonNullable<ProjectBriefingState['briefing']> {
  return { generatedAt: '2026-11-03T18:00:00Z', since: '2026-10-04T18:00:00Z', until: '2026-11-03T18:00:00Z', provider: 'gemini', model: 'test-model', content: { overview: [{ text: 'The team is preparing a pilot.', sources: [1] }], changes: [], decisions: [{ text: 'Run a pilot first.', sources: [1] }], questions: [{ text: 'Who will review the pilot?', sources: [2] }] }, sources: [{ number: 1, recordingId: 'call', title: 'Pilot planning', recordedAt: '2026-11-02T15:00:00Z', basis: 'summary', start: null, excerpt: 'Prepare a pilot.' }, { number: 2, recordingId: 'call', title: 'Pilot planning', recordedAt: '2026-11-02T15:00:00Z', basis: 'transcript', start: 15, excerpt: 'Who will review the pilot?' }] }
}
beforeEach(() => {
  changed = []
  state = { project: { id: 'team', name: 'Team' }, days: 30, since: '2026-10-04T18:00:00Z', until: '2026-11-03T18:00:00Z', briefing: null, sourcesChanged: false, busy: false, canGenerate: true, reason: null, coverage: { recentMeetings: 2, eligibleMeetings: 2, includedMeetings: 2, staleSummaries: 0 } }
  get.mockReset().mockImplementation(async (_project, options) => ({ ...state, days: options.days }))
  generate.mockReset().mockImplementation(async () => { state = { ...state, briefing: generated() }; return state })
  cancel.mockReset().mockResolvedValue(undefined)
  setAppClient({ projectBriefing: { get, generate, cancel }, library: { onChanged: callback => { changed.push(callback); return () => { changed = changed.filter(value => value !== callback) } } } } as unknown as AppClient)
})
afterEach(() => { cleanup(); vi.useRealTimers() })
function show(project = 'team') { return render(<MemoryRouter><ProjectBriefingPanel key={project} projectId={project} /></MemoryRouter>) }

describe('project Catch me up', () => {
  it('loads the briefing without generation or a task section', async () => {
    show(); await screen.findByRole('button', { name: 'Generate briefing' })
    expect(screen.queryByRole('heading', { name: /Overdue tasks/ })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Open Actionables' })).toBeNull()
    expect(generate).not.toHaveBeenCalled(); expect(get).toHaveBeenCalledWith('team', { days: 30 })
  })
  it('generates only on request and renders the evidence-linked sections', async () => {
    show(); fireEvent.click(await screen.findByRole('button', { name: 'Generate briefing' }))
    expect(await screen.findByText('The team is preparing a pilot.')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'What changed' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Recent decisions' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Open questions' })).toBeVisible()
    expect(screen.getByText('No supported changes between meetings were found in these sources.')).toBeVisible()
    expect(generate).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Refresh briefing' })).toBeEnabled()
  })
  it('shows summary provenance and links actual transcript evidence to its timestamp', async () => {
    state.briefing = generated(); show()
    fireEvent.click((await screen.findAllByRole('button', { name: 'Review source 1: Pilot planning' }))[0])
    const summary = screen.getByRole('dialog')
    expect(within(summary).getByText(/Saved AI summary; not a transcript quote/)).toBeVisible()
    fireEvent.click(within(summary).getByRole('button', { name: 'Close briefing source' }))
    fireEvent.click(screen.getByRole('button', { name: 'Review source 2: Pilot planning' }))
    expect(within(screen.getByRole('dialog')).getByText('Who will review the pilot?')).toBeVisible()
    expect(within(screen.getByRole('dialog')).getByRole('link', { name: 'Open recording at 0:15' })).toHaveAttribute('href', '/library/call?project=team&t=15')
  })
  it('switches periods without triggering AI and explains bounded or stale coverage', async () => {
    state.coverage = { ...state.coverage, eligibleMeetings: 20, includedMeetings: 12, staleSummaries: 1 }; state.sourcesChanged = true
    show(); await screen.findByText('Uses the most recent 12 summarized meetings in this period. Older meetings are outside this briefing.')
    expect(screen.getByText(/summary is out of date/)).toBeVisible(); expect(screen.getByText(/meeting sources or project context changed/)).toBeVisible()
    fireEvent.click(within(screen.getByRole('group', { name: 'Briefing period' })).getByRole('button', { name: '7 days' }))
    await waitFor(() => expect(get).toHaveBeenLastCalledWith('team', expect.objectContaining({ days: 7 })))
    expect(generate).not.toHaveBeenCalled()
  })
  it('preserves the last successful briefing and displays generation errors after refreshing live data', async () => {
    state.briefing = generated(); generate.mockRejectedValueOnce(Error('Provider is unavailable. Retry later.'))
    show(); fireEvent.click(await screen.findByRole('button', { name: 'Refresh briefing' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Provider is unavailable. Retry later.')
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(1))
    expect(screen.getByText('The team is preparing a pilot.')).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('Provider is unavailable. Retry later.')
  })
  it('disables duplicate generation and offers a cancel action', async () => {
    let reject!: (error: Error) => void
    generate.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
    cancel.mockImplementationOnce(async () => { reject(Error('Briefing generation cancelled.')) })
    show(); fireEvent.click(await screen.findByRole('button', { name: 'Generate briefing' }))
    expect(screen.getByRole('button', { name: 'Generating…' })).toBeDisabled()
    for (const button of within(screen.getByRole('group', { name: 'Briefing period' })).getAllByRole('button')) expect(button).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(cancel).toHaveBeenCalledWith('team'))
    expect(await screen.findByRole('alert')).toHaveTextContent('cancelled')
  })
  it('invalidates old briefing evidence on library events without regenerating', async () => {
    state.briefing = generated(); show(); await screen.findByText('The team is preparing a pilot.')
    state = { ...state, briefing: null, sourcesChanged: true }
    vi.useFakeTimers()
    await act(async () => { changed.forEach(callback => callback()); await vi.advanceTimersByTimeAsync(200) })
    expect(screen.getByText(/meeting sources or project context changed/)).toBeVisible()
    expect(screen.queryByText('The team is preparing a pilot.')).toBeNull(); expect(generate).not.toHaveBeenCalled()
  })
  it('shows a retry after a load failure and an explanatory empty/provider state', async () => {
    get.mockRejectedValueOnce(Error('Server unavailable'))
    state = { ...state, canGenerate: false, reason: 'Connect your selected chat provider in Settings.', coverage: { ...state.coverage } }
    show(); fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('link', { name: 'AI settings' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Generate briefing' })).toBeDisabled(); expect(generate).not.toHaveBeenCalled()
  })
  it('ignores a previous project response after navigating to another project', async () => {
    let resolve!: (value: ProjectBriefingState) => void
    get.mockImplementationOnce(() => new Promise<ProjectBriefingState>(done => { resolve = done }))
    const view = show('team')
    view.rerender(<MemoryRouter><ProjectBriefingPanel key="other" projectId="other" /></MemoryRouter>)
    await screen.findByRole('button', { name: 'Generate briefing' })
    await act(async () => { resolve({ ...state, briefing: { ...generated(), content: { ...generated().content, overview: [{ text: 'OLD PRIVATE PROJECT RESULT', sources: [1] }] } } }) })
    expect(screen.queryByText('OLD PRIVATE PROJECT RESULT')).toBeNull()
  })
})
