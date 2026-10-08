// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ProcessingQueue } from '../ProcessingQueue'
import { RecordingList } from '../RecordingList'
import { DEFAULT_AI_SETTINGS, type AIState } from '../../shared/ai'
import type { ElectronAPI, RecordingView } from '../../shared/contracts'

let state: AIState, refresh: () => void
beforeEach(() => {
  state = { settings: structuredClone(DEFAULT_AI_SETTINGS), providers: [], ready: true, reason: null, queue: { waiting: 24, active: { id: 'active', title: 'Saved conversation', stage: 'diarizing', progress: 0.4, message: 'Detecting speakers: section 2 of 8…', startedAt: null } } }
  window.electronAPI = { ai: { getState: vi.fn(async () => structuredClone(state)) }, library: { onChanged: (callback: () => void) => { refresh = callback; return vi.fn() } } } as unknown as ElectronAPI
})
afterEach(cleanup)
describe('visible transcription queue', () => {
  it('shows the active recording and real section progress above the waiting queue', async () => {
    render(<MemoryRouter><ProcessingQueue /></MemoryRouter>)
    expect(await screen.findByText('24 waiting')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Saved conversation' })).toHaveAttribute('href', '/library/active')
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '0.4')
    expect(screen.getByText(/do not need another download/)).toBeVisible()
  })
  it('updates from main-process events and disappears once the queue is finished', async () => {
    render(<MemoryRouter><ProcessingQueue /></MemoryRouter>)
    await screen.findByText('24 waiting')
    state.queue = { waiting: 0, active: null }; refresh()
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
  })
  it('shows a setup reason when the queue is genuinely blocked', async () => {
    state.queue = { waiting: 3, active: null }; state.ready = false; state.reason = 'Verify OpenAI in Settings.'
    render(<MemoryRouter><ProcessingQueue /></MemoryRouter>)
    expect(await screen.findByText('Verify OpenAI in Settings.')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Review transcription settings' })).toHaveAttribute('href', '/settings')
  })
  it('distinguishes saved audio and waiting position from an active spinning operation', () => {
    const recording = { id: 'waiting', filename: 'saved.hda', title: null, recordedAt: '2026-10-07T10:00:00Z', duration: 20, size: 200, status: 'queued', verified: true, hasAudio: true, projectId: null, summary: null, queuePosition: 2 } satisfies RecordingView
    const { container } = render(<MemoryRouter><RecordingList recordings={[recording]} /></MemoryRouter>)
    expect(screen.getByText('Waiting · #2')).toBeVisible()
    expect(screen.getByText('Downloaded')).toBeVisible()
    expect(container.querySelector('.animate-spin')).toBeNull()
  })
})
