// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { registerSW } from 'virtual:pwa-register'

const state = vi.hoisted(() => ({ busy: false, desktop: false, registration: null as unknown as ServiceWorkerRegistration, activate: vi.fn(), reload: vi.fn(), options: null as null | { onNeedRefresh(): void; onNeedReload(): void; onRegisteredSW(url: string, registration: ServiceWorkerRegistration): void } }))
vi.mock('virtual:pwa-register', () => ({ registerSW: vi.fn(options => { state.options = options; return vi.fn(async () => undefined) }) }))
vi.mock('../../services/web-update', () => ({ activateWebUpdate: state.activate, reloadWebApp: state.reload }))
vi.mock('../../services/browser-device', () => ({ browserDevice: { get busy() { return state.busy } } }))
vi.mock('../../services/desktop-recorder', () => ({ desktopBridge: () => state.desktop ? { version: 1 } : undefined }))
let panel: typeof import('../WebUpdatesPanel')
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers({ toFake: ['setInterval'] })
  state.busy = false; state.desktop = false; state.activate.mockReset().mockResolvedValue(undefined); state.reload.mockReset(); state.options = null; state.registration = {} as ServiceWorkerRegistration; vi.mocked(registerSW).mockClear()
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistration: vi.fn(async () => state.registration) } })
  panel = await import('../WebUpdatesPanel')
})
afterEach(() => { cleanup(); vi.useRealTimers() })
function ready() { panel.initializePwa(); act(() => { state.options!.onRegisteredSW('/sw.js', state.registration); state.options!.onNeedRefresh() }) }
describe('server interface updates', () => {
  it('waits for USB work and unsaved notes before starting an update', async () => {
    render(<panel.WebUpdateNotice />); expect(screen.queryByLabelText('App update')).toBeNull(); ready()
    state.busy = true; fireEvent.click(screen.getByRole('button', { name: 'Update app' })); expect(screen.getByRole('status')).toHaveTextContent('Finish USB sync'); expect(state.activate).not.toHaveBeenCalled()
    state.busy = false
    const pending = (event: Event) => event.preventDefault(); window.addEventListener('beforeunload', pending)
    try { fireEvent.click(screen.getByRole('button', { name: 'Update app' })); expect(screen.getByRole('status')).toHaveTextContent('Save or resolve your unsaved note'); expect(state.activate).not.toHaveBeenCalled() } finally { window.removeEventListener('beforeunload', pending) }
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Update app' })) }); expect(state.reload).toHaveBeenCalledOnce(); expect(state.activate).toHaveBeenCalledWith(state.registration)
  })
  it('shows shared progress and reloads only after activation finishes', async () => {
    let finish!: () => void; state.activate.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
    render(<><panel.WebUpdateNotice /><panel.WebUpdatesPanel /></>); ready()
    fireEvent.click(screen.getAllByRole('button', { name: 'Update app' })[0])
    expect(screen.getByLabelText('App update')).toHaveTextContent('Loading the latest app')
    expect(screen.getAllByRole('button', { name: 'Updating…' })).toHaveLength(2)
    for (const button of screen.getAllByRole('button', { name: 'Updating…' })) expect(button).toBeDisabled()
    expect(state.activate).toHaveBeenCalledOnce(); expect(state.reload).not.toHaveBeenCalled()
    await act(async () => { finish() }); expect(state.reload).toHaveBeenCalledOnce()
  })
  it.each(['usb', 'note'])('rechecks the %s guard if work starts while activation is pending', async guard => {
    let finish!: () => void; state.activate.mockImplementation(() => new Promise<void>(resolve => { finish = resolve }))
    render(<panel.WebUpdateNotice />); ready(); fireEvent.click(screen.getByRole('button', { name: 'Update app' }))
    const pending = (event: Event) => event.preventDefault()
    if (guard === 'usb') state.busy = true; else window.addEventListener('beforeunload', pending)
    try { await act(async () => { finish() }); expect(state.reload).not.toHaveBeenCalled(); expect(screen.getByRole('status')).toHaveTextContent(guard === 'usb' ? 'Finish USB sync' : 'Save or resolve your unsaved note') } finally { state.busy = false; window.removeEventListener('beforeunload', pending) }
    state.activate.mockResolvedValue(undefined); await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Update app' })) }); expect(state.reload).toHaveBeenCalledOnce()
  })
  it('reports activation failures and allows retry from the same button', async () => {
    state.activate.mockRejectedValueOnce(Error('The app update did not finish. Check your connection and retry.'))
    render(<panel.WebUpdateNotice />); ready(); fireEvent.click(screen.getByRole('button', { name: 'Update app' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('did not finish'))
    expect(screen.getByRole('button', { name: 'Update app' })).toBeEnabled(); expect(state.reload).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Update app' })) }); expect(state.reload).toHaveBeenCalledOnce()
  })
  it('offers an explicit update when another tab activates a worker without reloading this tab', () => {
    render(<panel.WebUpdateNotice />); panel.initializePwa(); act(() => state.options!.onNeedReload())
    expect(screen.getByLabelText('App update')).toBeVisible(); expect(state.reload).not.toHaveBeenCalled()
  })
  it('does not register a second service worker or polling timer when initialized twice', () => {
    panel.initializePwa(); panel.initializePwa(); expect(registerSW).toHaveBeenCalledOnce()
  })
  it('leaves service workers disabled in the server-only desktop client', () => {
    state.desktop = true; panel.initializePwa(); expect(registerSW).not.toHaveBeenCalled()
  })
  it('does not register a service worker at an insecure LAN address', () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false }); panel.initializePwa(); expect(registerSW).not.toHaveBeenCalled()
  })
})
