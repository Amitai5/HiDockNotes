import { appClient, setAppClient } from '../../services/app-client'
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RestoreSettingsPanel } from '../RestoreSettingsPanel'
import { EMPTY_RESTORE_STATE } from '../../shared/restore'
import type { AppClient } from '../../shared/contracts'
const preview = { id: 'preview', fileName: 'library.tar.gz', createdAt: '2026-10-20T10:00:00Z', appVersion: '0.10.0', counts: { recordings: 25, projects: 3, voice_profiles: 4, actionables: 20 }, localRecordings: 24, deviceOnly: 1, bytes: 1000000, changedAudio: 0 }
beforeEach(() => {
  setAppClient({ restore: { state: vi.fn(async () => ({ ...EMPTY_RESTORE_STATE, phase: 'ready', preview })), onState: vi.fn(() => vi.fn()), choose: vi.fn(), cancel: vi.fn(async () => undefined), confirm: vi.fn(async () => false) } } as unknown as AppClient)
})
afterEach(cleanup)
it('shows verified contents and requires explicit acknowledgement before choosing a safety backup', async () => {
  render(<RestoreSettingsPanel backupBusy={false} />)
  const confirm = await screen.findByRole('button', { name: 'Save current library and restore' })
  expect(screen.getByText('library.tar.gz')).toBeVisible()
  expect(screen.getByText('Remembered voices')).toBeVisible()
  expect(confirm).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(confirm)
  await waitFor(() => expect(appClient.restore.confirm).toHaveBeenCalledWith('preview', true))
  await waitFor(() => expect(confirm).toBeEnabled())
})
it('cancels the preview without scheduling a replacement', async () => {
  render(<RestoreSettingsPanel backupBusy={false} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
  expect(appClient.restore.cancel).toHaveBeenCalledOnce()
  expect(appClient.restore.confirm).not.toHaveBeenCalled()
})
