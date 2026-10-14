// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BackupSettingsPanel } from '../BackupSettingsPanel'
import { EMPTY_BACKUP_STATE, type BackupState } from '../../shared/backup'
import type { ElectronAPI } from '../../shared/contracts'

let changed: (state: BackupState) => void
beforeEach(() => {
  window.electronAPI = { backups: { state: vi.fn(async () => EMPTY_BACKUP_STATE), onState: vi.fn(callback => { changed = callback; return vi.fn() }), create: vi.fn(async () => null), cancel: vi.fn(async () => undefined), showFile: vi.fn(async () => undefined) } } as unknown as ElectronAPI
})
afterEach(cleanup)
describe('library backup Settings controls', () => {
  it('opens the save dialog, displays progress, supports cancellation and shows the saved archive', async () => {
    render(<BackupSettingsPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Create backup' }))
    await waitFor(() => expect(window.electronAPI.backups.create).toHaveBeenCalledOnce())
    await act(async () => changed({ ...EMPTY_BACKUP_STATE, phase: 'archiving', progress: 0.4, recordings: 25, totalBytes: 1000000, completedBytes: 400000 }))
    expect(screen.getByRole('button', { name: 'Creating backup…' })).toBeDisabled()
    expect(screen.getByRole('progressbar', { name: 'Backup progress' })).toHaveAttribute('value', '0.4')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel backup' }))
    expect(window.electronAPI.backups.cancel).toHaveBeenCalledOnce()
    await act(async () => changed({ ...EMPTY_BACKUP_STATE, phase: 'completed', progress: 1, recordings: 25, filePath: '/backups/library.tar.gz' }))
    expect(screen.getByText('Backup saved')).toBeVisible()
    expect(screen.getByText(/25 local audio recordings/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Show file' }))
    expect(window.electronAPI.backups.showFile).toHaveBeenCalledOnce()
  })
  it('keeps failures visible and does not call a cancelled save dialog a successful backup', async () => {
    render(<BackupSettingsPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Create backup' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create backup' })).toBeEnabled())
    expect(screen.queryByText('Backup saved')).toBeNull()
    await act(async () => changed({ ...EMPTY_BACKUP_STATE, phase: 'failed', error: 'Disk full.' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Disk full.')
    expect(screen.getByRole('button', { name: 'Create backup' })).toBeEnabled()
  })
})
