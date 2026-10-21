// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { VoiceProfilesPanel } from '../VoiceProfilesPanel'
import type { VoiceProfileView } from '../../shared/ai'
import type { ElectronAPI } from '../../shared/contracts'

let profiles: VoiceProfileView[]
const list = vi.fn(), rename = vi.fn(), merge = vi.fn(), deleteProfile = vi.fn(), deleteSample = vi.fn()
beforeEach(() => {
  profiles = [
    { id: 'alex', name: 'Alex Kim', samples: [{ id: 'sample-a', recordingId: 'recording-a', recordingTitle: 'Design review', createdAt: '2026-10-01T12:00:00Z' }] },
    { id: 'casey', name: 'Casey Lee', samples: [{ id: 'sample-b', recordingId: 'recording-b', recordingTitle: 'Project planning', createdAt: '2026-10-02T12:00:00Z' }] }
  ]
  list.mockReset().mockImplementation(async () => structuredClone(profiles))
  rename.mockReset().mockImplementation(async (id, name) => { profiles.find(profile => profile.id === id)!.name = name })
  merge.mockReset().mockImplementation(async (source, target) => { profiles.find(profile => profile.id === target)!.samples.push(...profiles.find(profile => profile.id === source)!.samples); profiles = profiles.filter(profile => profile.id !== source) })
  deleteProfile.mockReset().mockImplementation(async id => { profiles = profiles.filter(profile => profile.id !== id) })
  deleteSample.mockReset().mockImplementation(async id => { for (const profile of profiles) profile.samples = profile.samples.filter(sample => sample.id !== id) })
  window.electronAPI = { voices: { list, rename, merge, delete: deleteProfile, deleteSample }, library: { onChanged: vi.fn(() => vi.fn()) } } as unknown as ElectronAPI
})
afterEach(cleanup)
function open(): void { render(<MemoryRouter><VoiceProfilesPanel /></MemoryRouter>) }

describe('voice list and sample details', () => {
  it('shows only the selected person’s samples and links to their source recording', async () => {
    open()
    expect(await screen.findByRole('region', { name: 'Alex Kim voice samples' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Alex Kim, 1 sample' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('link', { name: /Project planning/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Casey Lee, 1 sample' }))
    expect(screen.getByRole('region', { name: 'Casey Lee voice samples' })).toBeVisible()
    expect(screen.getByRole('link', { name: /Project planning/ })).toHaveAttribute('href', '/library/recording-b')
    expect(screen.queryByRole('link', { name: /Design review/ })).toBeNull()
  })

  it('renames the selected person and keeps their details selected after refresh', async () => {
    open()
    await screen.findByRole('region', { name: 'Alex Kim voice samples' })
    fireEvent.click(screen.getByRole('button', { name: 'Casey Lee, 1 sample' }))
    fireEvent.click(screen.getByRole('button', { name: 'Rename Casey Lee' }))
    fireEvent.change(screen.getByLabelText('Voice profile name'), { target: { value: 'Casey Patel' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save voice name' }))
    expect(await screen.findByRole('region', { name: 'Casey Patel voice samples' })).toBeVisible()
    expect(rename).toHaveBeenCalledWith('casey', 'Casey Patel')
    expect(screen.getByRole('button', { name: 'Casey Patel, 1 sample' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows merge controls only in a dialog and requires a valid destination', async () => {
    open()
    await screen.findByRole('region', { name: 'Alex Kim voice samples' })
    expect(screen.queryByRole('combobox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Merge Alex Kim' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Merge voices' })).toBeDisabled()
    expect(within(dialog).queryByRole('option', { name: 'Alex Kim' })).toBeNull()
    fireEvent.change(within(dialog).getByLabelText('Merge into voice profile'), { target: { value: 'casey' } })
    expect(merge).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Merge voices' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(merge).toHaveBeenCalledWith('alex', 'casey')
    expect(screen.getByRole('region', { name: 'Casey Lee voice samples' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Casey Lee, 2 samples' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps the merge dialog and destination available after a failed merge', async () => {
    merge.mockRejectedValueOnce(new Error('Could not merge voices.'))
    open()
    await screen.findByRole('region', { name: 'Alex Kim voice samples' })
    fireEvent.click(screen.getByRole('button', { name: 'Merge Alex Kim' }))
    fireEvent.change(screen.getByLabelText('Merge into voice profile'), { target: { value: 'casey' } })
    fireEvent.click(screen.getByRole('button', { name: 'Merge voices' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not merge voices.')
    expect(screen.getByLabelText('Merge into voice profile')).toHaveValue('casey')
    expect(screen.getByRole('button', { name: 'Merge voices' })).toBeEnabled()
  })

  it('deletes only a confirmed sample and keeps its voice profile', async () => {
    open()
    await screen.findByRole('region', { name: 'Alex Kim voice samples' })
    fireEvent.click(screen.getByRole('button', { name: 'Delete voice sample from Design review' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(deleteSample).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete voice sample from Design review' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(deleteSample).toHaveBeenCalledWith('sample-a', true)
    expect(deleteProfile).not.toHaveBeenCalled()
    expect(screen.getByText('No samples yet')).toBeVisible()
    expect(screen.getByRole('region', { name: 'Alex Kim voice samples' })).toBeVisible()
  })

  it('selects a remaining person after profile deletion and handles deleting the last profile', async () => {
    open()
    await screen.findByRole('region', { name: 'Alex Kim voice samples' })
    fireEvent.click(screen.getByRole('button', { name: 'Delete Alex Kim' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(screen.getByRole('region', { name: 'Casey Lee voice samples' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Delete Casey Lee' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByText(/No remembered voices\./)).toBeVisible()
    expect(deleteProfile).toHaveBeenLastCalledWith('casey', true)
  })

  it('shows a retryable load error instead of an empty profile list', async () => {
    list.mockRejectedValueOnce(new Error('Voice library unavailable.'))
    open()
    expect(await screen.findByRole('alert')).toHaveTextContent('Voice library unavailable.')
    expect(screen.queryByText(/No remembered voices\./)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('region', { name: 'Alex Kim voice samples' })).toBeVisible()
  })
})
