import { appClient, setAppClient } from '../../services/app-client'
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ActivityLog } from '../ActivityLog'
import { getHiDockDeviceService } from '../../services/hidock-device'
import { useAppStore } from '../../store/useAppStore'
import { clearAllActivityBuffers } from '../../hooks/useDeviceSubscriptions'

const entry = { id: 'entry', timestamp: '2026-10-07T10:00:00Z', type: 'info' as const, category: 'Device', message: 'Downloaded a recording' }
beforeEach(() => {
  clearAllActivityBuffers()
  useAppStore.setState({ activityOpen: true })
  setAppClient({ activity: { clear: vi.fn().mockResolvedValue(undefined) }, devicePipeline: { getState: vi.fn(async () => ({ phase: 'idle', error: null })), onState: vi.fn(() => vi.fn()) }, ai: { getState: vi.fn(async () => ({ queue: { waiting: 2, waitingSummaries: 2, waitingTranscriptions: 0, reviewPaused: true, active: null } })) }, library: { onChanged: vi.fn(() => vi.fn()) } } as unknown as Window['electronAPI'])
})
afterEach(cleanup)
describe('Activity Log safety and interaction', () => {
  it('renders the portal outside the draggable application area', () => {
    const { container } = render(<div data-testid="drag-area" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}><ActivityLog /></div>)
    expect(container.contains(screen.getByRole('dialog'))).toBe(false)
    expect(screen.getByRole('button', { name: 'Close activity log' })).toBeDefined()
  })
  it('clears both the app store and device buffer so remount cannot replay stale events', async () => {
    getHiDockDeviceService().acceptActivity(entry)
    useAppStore.getState().addActivity(entry)
    render(<ActivityLog />)
    fireEvent.click(screen.getByRole('button', { name: 'Clear log' }))
    await waitFor(() => expect(useAppStore.getState().activity).toEqual([]))
    expect(appClient.activity.clear).toHaveBeenCalledOnce()
    expect(getHiDockDeviceService().getActivityLog()).toEqual([])
    const replay = vi.fn()
    getHiDockDeviceService().onActivity(replay)()
    expect(replay).not.toHaveBeenCalled()
  })
  it('closes with the close button and new events never reopen it', async () => {
    render(<ActivityLog />)
    fireEvent.click(screen.getByRole('button', { name: 'Close activity log' }))
    await waitFor(() => expect(useAppStore.getState().activityOpen).toBe(false))
    act(() => useAppStore.getState().addActivity(entry))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(useAppStore.getState().activityOpen).toBe(false)
  })
  it('closes with Escape', async () => {
    render(<ActivityLog />)
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(useAppStore.getState().activityOpen).toBe(false))
  })
  it('shows current recorder and paused summary status even when the historical log is empty', async () => {
    render(<ActivityLog />)
    expect(await screen.findByText('Recorder ready')).toBeVisible()
    expect(screen.getByText(/2 summary refreshes waiting/)).toBeVisible()
    expect(screen.getByText('No logged events')).toBeVisible()
    expect(screen.queryByText('All clear')).toBeNull()
  })
})
