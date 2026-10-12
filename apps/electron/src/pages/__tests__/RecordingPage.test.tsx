// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { RecordingPage } from '../RecordingPage'
import type { ElectronAPI, RecordingDetail } from '../../shared/contracts'
import { DEFAULT_AI_SETTINGS, DEFAULT_MODELS } from '../../shared/ai'

describe('recording processing results in the Library', () => {
  let detail: RecordingDetail
  let changed: () => void
  beforeEach(() => {
    detail = { recording: { id: 'recording', filename: 'call.hda', title: null, recordedAt: '2026-10-07T10:00:00Z', duration: 10, size: 200, status: 'queued', verified: true, hasAudio: false, projectId: null, summary: null }, segments: [], actionables: [], processing: { stage: 'queued', progress: 0, message: 'Waiting to process…', error: null, attempt: 0, nextAttemptAt: null } }
    window.electronAPI = { library: { detail: vi.fn(async () => structuredClone(detail)), onChanged: vi.fn(callback => { changed = callback; return vi.fn() }) }, projects: { list: vi.fn(async () => []) }, ai: { getState: vi.fn(async () => ({ settings: DEFAULT_AI_SETTINGS, providers: [{ provider: 'gemini', models: DEFAULT_MODELS.gemini }], ready: true, reason: null })) } } as unknown as ElectronAPI
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry processing' })).toBeEnabled())
  })
})
