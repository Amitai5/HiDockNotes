import { appClient, setAppClient } from '../../services/app-client'
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CalendarSettings } from '../CalendarSettings'
import { RecordingCalendar } from '../RecordingCalendar'
import { OptionalSearchSetup, SemanticSearchSettings } from '../SemanticSearchSettings'
import { EMPTY_SEMANTIC_STATE } from '../../shared/semantic-search'
import type { CalendarEvent, CalendarState } from '../../shared/calendar'
import type { AppClient } from '../../shared/contracts'

const event: CalendarEvent = { id: 'event', sourceId: 'calendar', calendarName: 'Work', title: 'Intake review', description: 'Review the form', location: 'Video call', start: '2026-10-21T17:00:00.000Z', end: '2026-10-21T18:00:00.000Z', allDay: false, organizer: { name: 'Dana', email: null }, invitees: [{ name: 'Alex', email: null }], cancelled: false, available: true }
let calendarState: CalendarState
beforeEach(() => {
  calendarState = { sources: [{ id: 'calendar', name: 'Work', connected: true, lastSyncedAt: null, events: 1, error: null }], syncing: false, error: null }
  setAppClient({
    library: { onChanged: vi.fn(() => vi.fn()) },
    calendar: { state: vi.fn(async () => calendarState), onChanged: vi.fn(() => vi.fn()), openSettings: vi.fn(async () => undefined), connect: vi.fn(async () => calendarState), refresh: vi.fn(async () => calendarState), disconnect: vi.fn(async () => ({ ...calendarState, sources: [] })), forRecording: vi.fn(async () => ({ linked: null, suggestions: [event] })), link: vi.fn(async () => undefined), useTitle: vi.fn(async () => undefined) },
    semanticSearch: { state: vi.fn(async () => ({ ...EMPTY_SEMANTIC_STATE })), onState: vi.fn(() => vi.fn()), enable: vi.fn(async () => ({ ...EMPTY_SEMANTIC_STATE, enabled: true, phase: 'downloading' })), disable: vi.fn(async () => ({ ...EMPTY_SEMANTIC_STATE })), dismissSetup: vi.fn(async () => undefined), removeModel: vi.fn(async () => ({ ...EMPTY_SEMANTIC_STATE })) }
  } as unknown as AppClient)
})
afterEach(cleanup)
describe('calendar and optional meaning search controls', () => {
  it('connects with an explicitly entered link, clears the secret field, and opens fixed Google settings', async () => {
    render(<CalendarSettings />)
    await screen.findByText('Work')
    fireEvent.change(screen.getByLabelText('Calendar name'), { target: { value: 'Personal' } })
    const secret = screen.getByLabelText('Private iCal link')
    expect(secret).toHaveAttribute('type', 'password')
    fireEvent.change(secret, { target: { value: 'https://calendar.google.com/calendar/ical/x/private-fake/basic.ics' } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect calendar' }))
    await waitFor(() => expect(appClient.calendar.connect).toHaveBeenCalledWith('Personal', 'https://calendar.google.com/calendar/ical/x/private-fake/basic.ics'))
    expect(secret).toHaveValue('')
    fireEvent.click(screen.getByText('Where to find the link'))
    fireEvent.click(screen.getByRole('button', { name: 'Open Google Calendar settings' }))
    expect(appClient.calendar.openSettings).toHaveBeenCalledOnce()
  })
  it('shows connection errors without echoing the entered private link', async () => {
    vi.mocked(appClient.calendar.connect).mockRejectedValueOnce(new Error('Calendar could not be refreshed.'))
    render(<CalendarSettings />)
    fireEvent.change(screen.getByLabelText('Calendar name'), { target: { value: 'Personal' } })
    fireEvent.change(screen.getByLabelText('Private iCal link'), { target: { value: 'private-secret-url' } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect calendar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be refreshed')
    expect(screen.getByLabelText('Private iCal link')).toHaveValue('')
  })
  it('requires calendar removal confirmation and supports cancellation', async () => {
    render(<CalendarSettings />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Work' }))
    expect(appClient.calendar.disconnect).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(appClient.calendar.disconnect).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Work' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove calendar' }))
    await waitFor(() => expect(appClient.calendar.disconnect).toHaveBeenCalledWith('calendar', true))
  })
  it('offers nearby meetings without linking automatically', async () => {
    render(<MemoryRouter><RecordingCalendar id="recording" /></MemoryRouter>)
    await waitFor(() => expect(appClient.calendar.forRecording).toHaveBeenCalledWith('recording'))
    expect(appClient.calendar.link).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Link meeting' }))
    fireEvent.click(await screen.findByRole('button', { name: /Intake review/ }))
    await waitFor(() => expect(appClient.calendar.link).toHaveBeenCalledWith('recording', 'event'))
  })
  it('labels invitees separately and requires confirmation before replacing a recording title', async () => {
    vi.mocked(appClient.calendar.forRecording).mockResolvedValue({ linked: event, suggestions: [] })
    render(<MemoryRouter><RecordingCalendar id="recording" /></MemoryRouter>)
    expect(await screen.findByText('Invited:')).toBeVisible()
    expect(screen.getByText(/Alex/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Use event title' }))
    expect(appClient.calendar.useTitle).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Use event title' }))
    await waitFor(() => expect(appClient.calendar.useTitle).toHaveBeenCalledWith('recording'))
  })
  it('shows a title-change failure inside the confirmation dialog and allows retry', async () => {
    vi.mocked(appClient.calendar.forRecording).mockResolvedValue({ linked: event, suggestions: [] })
    vi.mocked(appClient.calendar.useTitle).mockRejectedValueOnce(new Error('Recording is being deleted.'))
    render(<MemoryRouter><RecordingCalendar id="recording" /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Use event title' }))
    const dialog = screen.getByRole('dialog', { name: 'Use calendar title?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use event title' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Recording is being deleted.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use event title' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Use calendar title?' })).toBeNull())
  })
  it('makes the first-run model download opt-in and allows skipping', async () => {
    render(<OptionalSearchSetup />)
    expect(await screen.findByText('Optional: search by meaning')).toBeVisible()
    expect(appClient.semanticSearch.enable).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(appClient.semanticSearch.dismissSetup).toHaveBeenCalledOnce()
    expect(appClient.semanticSearch.enable).not.toHaveBeenCalled()
  })
  it('starts a model download only when the user chooses to enable it', async () => {
    render(<SemanticSearchSettings />)
    expect(screen.getByRole('switch', { name: 'Local meaning search' })).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Download & enable' }))
    await waitFor(() => expect(appClient.semanticSearch.enable).toHaveBeenCalledOnce())
  })
  it('requires confirmation before removing a downloaded model', async () => {
    vi.mocked(appClient.semanticSearch.state).mockResolvedValue({ ...EMPTY_SEMANTIC_STATE, modelReady: true, enabled: true, phase: 'ready' })
    render(<SemanticSearchSettings />)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove model' }))
    expect(appClient.semanticSearch.removeModel).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Remove model' }))
    await waitFor(() => expect(appClient.semanticSearch.removeModel).toHaveBeenCalledWith(true))
  })
})
