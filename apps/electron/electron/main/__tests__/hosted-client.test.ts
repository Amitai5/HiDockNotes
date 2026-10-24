import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  const handlers = new Map<string, (...args: any[]) => any>(), events = new Map<string, (...args: any[]) => any>()
  const windows: any[] = [], failures = new Set<string>()
  class Window {
    options: any
    url = ''
    webContents = { mainFrame: { url: '' }, getURL: () => this.url, on: vi.fn((name, callback) => events.set(name, callback)), setWindowOpenHandler: vi.fn(), send: vi.fn() }
    loadURL = vi.fn(async (url: string) => {
      if (failures.has(url)) { events.get('did-fail-load')!({}, -102, 'Connection refused', url, true); throw new Error('Connection refused') }
      this.url = url; this.webContents.mainFrame.url = url
    })
    isDestroyed = () => false
    constructor(options: unknown) { this.options = options; windows.push(this) }
  }
  return {
    handlers, events, windows, failures, Window,
    app: { setAppUserModelId: vi.fn(), requestSingleInstanceLock: vi.fn(() => true), quit: vi.fn(), exit: vi.fn(), getPath: vi.fn(() => '/isolated-client'), whenReady: vi.fn(async () => undefined), on: vi.fn(), relaunch: vi.fn(), isPackaged: false },
    menu: { buildFromTemplate: vi.fn(value => value), setApplicationMenu: vi.fn() },
    read: vi.fn((): { origin: string | null } => ({ origin: null })), save: vi.fn(), recorder: vi.fn()
  }
})
vi.mock('electron', () => ({ app: state.app, BrowserWindow: state.Window, ipcMain: { handle: (name: string, callback: (...args: any[]) => any) => state.handlers.set(name, callback) }, Menu: state.menu, dialog: { showErrorBox: vi.fn() } }))
vi.mock('../server-connection', async importOriginal => ({ ...await importOriginal<typeof import('../server-connection')>(), readServerConnection: state.read, saveServerConnection: state.save }))
vi.mock('../hosted-recorder', async importOriginal => ({ ...await importOriginal<typeof import('../hosted-recorder')>(), HostedRecorder: state.recorder }))

beforeEach(() => { vi.resetModules(); state.handlers.clear(); state.events.clear(); state.failures.clear(); state.windows.length = 0; state.read.mockReset().mockReturnValue({ origin: null }); state.save.mockClear(); state.recorder.mockClear(); state.app.relaunch.mockClear(); state.app.quit.mockClear(); state.app.exit.mockClear() })
afterEach(() => vi.useRealTimers())
async function start() { await import('../hosted-client'); await vi.waitFor(() => expect(state.windows).toHaveLength(1)); return state.windows[0] }
function event(window: any, url = window.url) { window.webContents.mainFrame.url = url; return { sender: window.webContents, senderFrame: window.webContents.mainFrame } }
function serverMenu() { return state.menu.buildFromTemplate.mock.lastCall![0].find((item: any) => item.label === 'Server').submenu }

describe('server-only desktop startup', () => {
  it('shows connection setup without a saved server and registers no local-library operation', async () => {
    const window = await start()
    expect(window.url).toMatch(/\/renderer\/server\.html$/)
    expect(state.handlers.get('server-connection:get')!(event(window))).toEqual({ origin: null, error: undefined })
    expect(state.handlers.has('server-connection:local')).toBe(false)
    expect(serverMenu().some((item: any) => /local/i.test(item.label ?? ''))).toBe(false)
    expect(serverMenu().find((item: any) => item.label === 'Open server library').enabled).toBe(false)
    expect(state.recorder).not.toHaveBeenCalled()
    await expect(state.handlers.get('hosted-device:call')!(event(window), 'connect', [])).rejects.toThrow('cannot access')
  })
  it('opens only the configured server in a sandboxed window', async () => {
    state.read.mockReturnValue({ origin: 'https://notes.example.com' })
    const window = await start()
    expect(window.url).toBe('https://notes.example.com')
    expect(window.options.webPreferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false })
    expect(window.options.webPreferences.preload).toMatch(/preload[\\/]server\.js$/)
    expect(state.recorder).not.toHaveBeenCalled()
  })
  it('returns to connection setup when the server cannot be reached', async () => {
    state.read.mockReturnValue({ origin: 'https://notes.example.com' })
    const window = await start()
    state.events.get('did-fail-load')!({}, -102, 'Connection refused', 'https://notes.example.com/', true)
    expect(window.loadURL).toHaveBeenLastCalledWith(expect.stringMatching(/\/renderer\/server\.html$/))
    expect(state.handlers.get('server-connection:get')!(event(window)).error).toMatch(/Could not reach/)
    expect(state.recorder).not.toHaveBeenCalled()
  })
  it('recovers a malformed old connection preference through setup', async () => {
    state.read.mockImplementation(() => { throw new Error('Malformed preference') })
    const window = await start()
    expect(window.url).toMatch(/\/renderer\/server\.html$/)
    expect(state.handlers.get('server-connection:get')!(event(window)).error).toMatch(/saved server address/)
    expect(state.save).not.toHaveBeenCalled()
  })
  it('coalesces startup load rejection and its failure event into one setup navigation', async () => {
    state.read.mockReturnValue({ origin: 'https://notes.example.com' }); state.failures.add('https://notes.example.com')
    const window = await start()
    await vi.waitFor(() => expect(window.url).toMatch(/\/renderer\/server\.html$/))
    expect(window.loadURL.mock.calls.filter(([url]: [string]) => url.endsWith('/server.html'))).toHaveLength(1)
    expect(state.app.exit).not.toHaveBeenCalled()
  })
  it('saves an explicitly chosen server and restarts without accepting a local-mode value', async () => {
    const window = await start(), connect = state.handlers.get('server-connection:connect')!
    expect(() => connect(event(window), null)).toThrow('HTTPS')
    expect(state.save).not.toHaveBeenCalled()
    vi.useFakeTimers()
    connect(event(window), 'https://notes.example.com/')
    expect(state.save).toHaveBeenCalledWith('/isolated-client', 'https://notes.example.com')
    vi.advanceTimersByTime(100)
    expect(state.app.relaunch).toHaveBeenCalledOnce()
    expect(state.app.quit).toHaveBeenCalledOnce()
  })
  it('rejects connection changes from another origin or a child frame', async () => {
    state.read.mockReturnValue({ origin: 'https://notes.example.com' })
    const window = await start(), connect = state.handlers.get('server-connection:connect')!
    expect(() => connect(event(window, 'https://identity.example.com/'), 'https://other.example.com')).toThrow('cannot access')
    expect(() => connect({ sender: window.webContents, senderFrame: { url: 'https://notes.example.com' } }, 'https://other.example.com')).toThrow('Untrusted')
    expect(state.save).not.toHaveBeenCalled()
  })
})
