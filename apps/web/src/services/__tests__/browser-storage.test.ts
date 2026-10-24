// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { browserStorageAvailability } from '../browser-storage'
import { BrowserCapture, recoverBrowserCaptures } from '../browser-capture'
import { secureSyncUrl, setServerOrigin } from '../server-origin'
afterEach(() => vi.unstubAllGlobals())
it('rejects recovery and live capture before network or file access on an insecure origin', async () => {
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false })
  vi.stubGlobal('navigator', {})
  expect(browserStorageAvailability()).toContain('HTTPS')
  await expect(recoverBrowserCaptures()).rejects.toThrow('HTTPS')
  const source = { startRealtime: vi.fn(), stopRealtime: vi.fn(), getRealtimeData: vi.fn() }
  await expect(new BrowserCapture(source, vi.fn()).start('P1')).rejects.toThrow('HTTPS'); expect(source.startRealtime).not.toHaveBeenCalled()
})
it('advertises only a validated HTTPS origin, without URL credentials or parameters', () => {
  setServerOrigin('https://notes.example.com'); expect(secureSyncUrl()).toBe('https://notes.example.com/#/sync')
  for (const origin of ['http://truenas.local:10708', 'javascript:alert(1)', 'https://user:secret@notes.example.com', 'https://notes.example.com?token=secret', undefined]) { setServerOrigin(origin); expect(secureSyncUrl()).toBeNull() }
})
