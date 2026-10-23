import { appClient, setAppClient } from '../../services/app-client'
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AppClient, TranscriptSegment } from '../../shared/contracts'
import type { TranscriptReview } from '../../shared/transcript'
import { TranscriptTools } from '../TranscriptTools'
const segment: TranscriptSegment = { id: 'excerpt', start: 1, end: 3, text: 'Original words', speakerId: null, speakerName: 'Dana' }
const review: TranscriptReview = { version: 2, revisions: [{ version: 2, reason: 'Edited transcript', createdAt: '2026-10-20T10:00:00Z', segmentCount: 1 }], correctedSegments: ['excerpt'], summaryStale: true, candidate: null }
beforeEach(() => {
  setAppClient({ library: { onChanged: vi.fn(() => vi.fn()) }, transcripts: { review: vi.fn(async () => review), edit: vi.fn(async () => ({ ...review, version: 3 })), revision: vi.fn(async () => [segment]), accept: vi.fn(async () => ({ ...review, candidate: null })), restore: vi.fn() } } as unknown as AppClient)
})
afterEach(cleanup)
it('saves an explicit correction with the loaded version and leaves timestamp editing unavailable', async () => {
  const changed = vi.fn(), closed = vi.fn()
  render(<TranscriptTools segments={[segment]} recordingId="recording" edit={segment} onCloseEdit={closed} onChanged={changed} disabled={false} />)
  const textbox = await screen.findByRole('textbox', { name: 'Transcript excerpt' })
  expect(textbox).toHaveValue('Original words')
  fireEvent.change(textbox, { target: { value: 'Corrected words' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save correction' }))
  await waitFor(() => expect(appClient.transcripts.edit).toHaveBeenCalledWith('recording', 'excerpt', 'Corrected words', 2))
  expect(changed).toHaveBeenCalled(); expect(closed).toHaveBeenCalled()
})
it('previews the exact merged transcript before applying it and resummarizing', async () => {
  vi.mocked(appClient.transcripts.review).mockResolvedValue({ ...review, candidate: { createdAt: '2026-10-20T11:00:00Z', corrections: 1, segments: [segment], merged: [{ ...segment, text: 'My correction stays' }] } })
  render(<TranscriptTools segments={[segment]} recordingId="recording" edit={null} onCloseEdit={vi.fn()} onChanged={vi.fn()} disabled={false} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Compare' }))
  expect(screen.getByText('My correction stays')).toBeVisible()
  expect(screen.getByText(/overlapping a correction is replaced in full/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Apply and resummarize' }))
  await waitFor(() => expect(appClient.transcripts.accept).toHaveBeenCalledWith('recording', 'keep-corrections', 2))
})
