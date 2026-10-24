// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { BrowserSyncTools } from '../BrowserSyncTools'
import { setServerOrigin } from '../../services/server-origin'
const mock = vi.hoisted(() => ({ reason: null as string | null, capture: vi.fn() }))
vi.mock('../../services/browser-device', () => ({ usbAvailability: () => mock.reason, browserDevice: { isCapturing: false, startCapture: mock.capture, api: { getState: async () => ({ device: null, phase: 'disconnected' }), onState: () => () => undefined } } }))
vi.mock('../../services/http', () => ({ request: async () => [], clientEvents: new EventTarget() }))
beforeEach(() => { mock.reason = null; Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true }); Object.defineProperty(navigator, 'storage', { configurable: true, value: { getDirectory: vi.fn() } }); setServerOrigin('https://notes.example.com') })
afterEach(cleanup)
it('opens the configured HTTPS sync page and disables unavailable HTTP-only controls', async () => {
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false }); mock.reason = 'Device sync needs HTTPS. Open the secure server address.'
  render(<BrowserSyncTools />)
  expect(screen.getByRole('link', { name: 'Open secure device sync' })).toHaveAttribute('href', 'https://notes.example.com/#/sync')
  expect(screen.getByRole('button', { name: 'Start live capture' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Recover browser capture' })).toBeDisabled()
})
it('does not start live capture before a recorder is connected', () => { render(<BrowserSyncTools />); expect(screen.getByRole('button', { name: 'Start live capture' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Recover browser capture' })).toBeEnabled() })
it('explains absent browser file storage and disables recovery', () => { Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined }); render(<BrowserSyncTools />); expect(screen.getByText(/temporary file storage/)).toBeVisible(); expect(screen.getByRole('button', { name: 'Recover browser capture' })).toBeDisabled() })
