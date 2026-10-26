// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { registerSW } from 'virtual:pwa-register'
import { initializePwa, WebUpdateNotice } from '../WebUpdatesPanel'

const state = vi.hoisted(() => ({ busy: false, desktop: false, refresh: vi.fn(async () => undefined), options: null as null | { onNeedRefresh(): void } }))
vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn(options => { state.options = options; return state.refresh }) }))
vi.mock('../../services/browser-device', () => ({ browserDevice: { get busy() { return state.busy } } }))
vi.mock('../../services/desktop-recorder', () => ({ desktopBridge: () => state.desktop ? { version: 1 } : undefined }))
beforeEach(() => {
  state.busy = false; state.desktop = false; state.refresh.mockClear(); vi.mocked(registerSW).mockClear()
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {} })
})
afterEach(cleanup)
describe('server interface updates', () => {
  it('offers an update throughout the app and waits for USB work and unsaved notes', async () => {
    render(<WebUpdateNotice />); expect(screen.queryByLabelText('App update')).toBeNull()
    initializePwa(); act(() => state.options!.onNeedRefresh())
    expect(screen.getByLabelText('App update')).toHaveTextContent('A new version is ready')
    state.busy = true; fireEvent.click(screen.getByRole('button', { name: 'Update app' }))
    expect(screen.getByRole('status')).toHaveTextContent('Finish USB sync'); expect(state.refresh).not.toHaveBeenCalled()
    state.busy = false
    const pendingNote = (event: Event) => event.preventDefault()
    window.addEventListener('beforeunload', pendingNote)
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Update app' }))
      expect(screen.getByRole('status')).toHaveTextContent('Save or resolve your unsaved note'); expect(state.refresh).not.toHaveBeenCalled()
    } finally { window.removeEventListener('beforeunload', pendingNote) }
    fireEvent.click(screen.getByRole('button', { name: 'Update app' })); expect(state.refresh).toHaveBeenCalledWith(true)
  })
  it('leaves service workers disabled in the server-only desktop client', () => {
    state.desktop = true; initializePwa(); expect(registerSW).not.toHaveBeenCalled()
  })
  it('does not register a service worker at an insecure LAN address', () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false })
    initializePwa(); expect(registerSW).not.toHaveBeenCalled()
  })
})
