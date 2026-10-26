// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { appClient, setAppClient } from '../../services/app-client'
import type { AppClient } from '../../shared/contracts'
import { RecordingReprocess } from '../RecordingReprocess'
import { useAppStore } from '../../store/useAppStore'

beforeEach(() => {
  useAppStore.setState({ error: null })
  setAppClient({ library: { setSpeakerCount: vi.fn(async () => undefined) }, ai: { reprocess: vi.fn(async () => undefined) } } as unknown as AppClient)
})
afterEach(cleanup)
describe('speaker choice before retranscription', () => {
  it('requires a speaker choice and persists it before starting the new transcription', async () => {
    let accept!: () => void
    vi.mocked(appClient.library.setSpeakerCount).mockImplementationOnce(() => new Promise<void>(resolve => { accept = resolve }))
    render(<RecordingReprocess id="recording" canTranscribe canSummarize onQueued={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Retranscribe', exact: true }))
    const confirm = screen.getByRole('button', { name: 'Retranscribe and summarize' })
    expect(confirm).toBeDisabled(); expect(appClient.ai.reprocess).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Speakers for retranscription'), { target: { value: '3' } }); fireEvent.click(confirm)
    expect(appClient.library.setSpeakerCount).toHaveBeenCalledWith('recording', 3); expect(appClient.ai.reprocess).not.toHaveBeenCalled()
    accept(); await waitFor(() => expect(appClient.ai.reprocess).toHaveBeenCalledWith('recording', 'transcribe'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
  it('lets the user explicitly choose automatic detection for a retranscription', async () => {
    render(<RecordingReprocess id="recording" canTranscribe canSummarize onQueued={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Retranscribe', exact: true }))
    fireEvent.change(screen.getByLabelText('Speakers for retranscription'), { target: { value: 'auto' } })
    fireEvent.click(screen.getByRole('button', { name: 'Retranscribe and summarize' }))
    await waitFor(() => expect(appClient.ai.reprocess).toHaveBeenCalledWith('recording', 'transcribe')); expect(appClient.library.setSpeakerCount).toHaveBeenCalledWith('recording', null)
  })
  it('keeps cancel and summary-only actions from changing speakers or starting transcription', async () => {
    render(<RecordingReprocess id="recording" canTranscribe canSummarize onQueued={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Retranscribe', exact: true })); fireEvent.change(screen.getByLabelText('Speakers for retranscription'), { target: { value: '2' } }); fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(appClient.library.setSpeakerCount).not.toHaveBeenCalled(); expect(appClient.ai.reprocess).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Resummarize', exact: true })); expect(screen.queryByLabelText('Speakers for retranscription')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Generate summary' })); await waitFor(() => expect(appClient.ai.reprocess).toHaveBeenCalledWith('recording', 'summarize')); expect(appClient.library.setSpeakerCount).not.toHaveBeenCalled()
  })
  it('preserves the prompt and avoids queueing when the speaker preference cannot save', async () => {
    vi.mocked(appClient.library.setSpeakerCount).mockRejectedValueOnce(Error('Server unavailable'))
    render(<RecordingReprocess id="recording" expectedSpeakers={4} canTranscribe canSummarize onQueued={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Retranscribe', exact: true })); expect(screen.getByLabelText('Speakers for retranscription')).toHaveValue('4')
    fireEvent.click(screen.getByRole('button', { name: 'Retranscribe and summarize' })); await waitFor(() => expect(useAppStore.getState().error).toBe('Server unavailable'))
    expect(appClient.ai.reprocess).not.toHaveBeenCalled(); expect(screen.getByRole('dialog')).toBeVisible()
  })
})
