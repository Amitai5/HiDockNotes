import { appClient, setAppClient } from '../../services/app-client'
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RecordingExport } from '../RecordingExport'
import type { AppClient, RecordingView } from '../../shared/contracts'

const recording: RecordingView = { id: 'recording', filename: 'call.hda', title: 'Planning', recordedAt: '2026-10-08T10:00:00Z', duration: 10, size: 200, status: 'done', verified: true, hasAudio: true, projectId: null, summary: '## Decisions\nSend the plan.' }
describe('recording export options', () => {
  beforeEach(() => { setAppClient({ library: { exportText: vi.fn(async () => true) } } as unknown as AppClient )})
  afterEach(cleanup)
  it('lets the user export only the summary with audio and sends typed choices through the bridge', async () => {
    render(<RecordingExport recording={recording} />)
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    fireEvent.click(screen.getByRole('radio', { name: /Summary only/ }))
    fireEvent.change(screen.getByLabelText('Include audio'), { target: { value: 'yes' } })
    fireEvent.click(screen.getByRole('button', { name: 'Export recording' }))
    await waitFor(() => expect(appClient.library.exportText).toHaveBeenCalledWith('recording', { content: 'summary', format: 'md', includeAudio: true }))
    await screen.findByText('Export saved')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('retains the summary and transcript choice, and keeps the dialog open if native saving is cancelled', async () => {
    vi.mocked(appClient.library.exportText).mockResolvedValue(false)
    render(<RecordingExport recording={recording} />)
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    fireEvent.change(screen.getByLabelText('Export format'), { target: { value: 'txt' } })
    fireEvent.click(screen.getByRole('button', { name: 'Export recording' }))
    await waitFor(() => expect(appClient.library.exportText).toHaveBeenCalledWith('recording', { content: 'summary-transcript', format: 'txt', includeAudio: false }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByText('Export saved')).not.toBeInTheDocument()
  })
  it('preserves subtitle exports and switches back to Markdown for summary-only exports', () => {
    render(<RecordingExport recording={recording} />)
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    fireEvent.change(screen.getByLabelText('Export format'), { target: { value: 'srt' } })
    expect(screen.getByText(/Subtitle files contain/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: /Summary only/ }))
    expect(screen.getByLabelText('Export format')).toHaveValue('md')
  })
  it('disables optional audio until the local copy is verified and closes on Escape', () => {
    render(<RecordingExport recording={{ ...recording, verified: false }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    expect(screen.getByLabelText('Include audio')).toBeDisabled()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
