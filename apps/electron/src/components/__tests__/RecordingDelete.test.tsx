// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { RecordingDelete } from '../RecordingDelete'
import type { ElectronAPI, RecordingView } from '../../shared/contracts'
import type { RecordingDeletionInfo } from '../../shared/recording-deletion'
let changed: () => void, info: RecordingDeletionInfo
const recording: RecordingView = { id: 'recording', filename: 'saved.hda', title: 'Review', recordedAt: '2026-10-13T10:00:00Z', duration: 20, size: 200, status: 'done', verified: true, hasAudio: true, projectId: null, summary: 'Saved notes' }
beforeEach(() => {
  info = { deviceRequired: true, deviceDone: false, allowed: false, reason: 'Reading recorder information.' }
  window.electronAPI = { library: { deletionInfo: vi.fn(async () => structuredClone(info)) }, devicePipeline: { onState: vi.fn(callback => { changed = () => callback({ phase: 'idle' } as never); return vi.fn() }) } } as unknown as ElectronAPI
})
afterEach(cleanup)
describe('live recorder deletion readiness', () => {
  it('enables deletion automatically when the recorder finishes initialization without closing the dialog', async () => {
    render(<RecordingDelete recording={recording} open onOpenChange={vi.fn()} onClosed={vi.fn()} />)
    expect(await screen.findByText('Reading recorder information.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Delete recording' })).toBeDisabled()
    info = { ...info, allowed: true, reason: null }
    await act(async () => changed())
    expect(screen.getByRole('button', { name: 'Delete recording' })).toBeEnabled()
    expect(screen.queryByText('Reading recorder information.')).toBeNull()
  })
  it('ignores an older blocked response after a newer ready response', async () => {
    let resolveOld: ((value: RecordingDeletionInfo) => void) | undefined
    vi.mocked(window.electronAPI.library.deletionInfo).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
    render(<RecordingDelete recording={recording} open onOpenChange={vi.fn()} onClosed={vi.fn()} />)
    info = { ...info, allowed: true, reason: null }
    await act(async () => changed())
    expect(screen.getByRole('button', { name: 'Delete recording' })).toBeEnabled()
    await act(async () => resolveOld?.({ ...info, allowed: false, reason: 'Stale blocked response' }))
    expect(screen.getByRole('button', { name: 'Delete recording' })).toBeEnabled()
  })
})
