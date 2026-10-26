import { app, BrowserWindow, ipcMain, Menu, dialog } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import product from '../../product.json'
import { HostedRecorder, isTrustedServerFrame } from './hosted-recorder'
import { readServerConnection, saveServerConnection, validateServerOrigin } from './server-connection'

app.setAppUserModelId(product.appId)
const ownsInstance = app.requestSingleInstanceLock()
if (!ownsInstance) app.quit()
let window: BrowserWindow | undefined, recorder: HostedRecorder | undefined, stopping = false, closed = false
let origin: string | null = null, connectionError: string | undefined
try { origin = readServerConnection(app.getPath('userData')).origin } catch { connectionError = 'The saved server address could not be read. Enter your server address again.' }
const setup = pathToFileURL(join(__dirname, '../renderer/server.html')).href

async function nativeRecorder(): Promise<HostedRecorder> {
  if (!recorder) {
    const { JensenDevice } = await import('./services/jensen')
    const device = new JensenDevice()
    device.ondisconnect = reason => { if (reason === 'physical' && window && !window.isDestroyed()) window.webContents.send('hosted-device:detached') }
    recorder = new HostedRecorder(device, app.getPath('temp'), bytes => { if (window && !window.isDestroyed()) window.webContents.send('hosted-device:progress', bytes) })
  }
  return recorder
}
function assertWindow(event: Electron.IpcMainInvokeEvent, remoteOnly = false): void {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted desktop client frame.')
  const url = event.senderFrame.url
  if (!(origin && isTrustedServerFrame(url, origin)) && (remoteOnly || url.split('#')[0] !== setup)) throw new Error('This page cannot access the desktop connection.')
}
function switchConnection(value: string): void {
  if (recorder?.busy) throw new Error('Finish or cancel device sync or live capture before changing servers.')
  saveServerConnection(app.getPath('userData'), value)
  setTimeout(() => { app.relaunch(); app.quit() }, 100)
}
async function createWindow(): Promise<void> {
  const icon = app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(__dirname, '../../resources/icon.png')
  window = new BrowserWindow({ width: 1340, height: 900, minWidth: 980, minHeight: 650, title: product.name, icon,
    webPreferences: { preload: join(__dirname, '../preload/server.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, additionalArguments: [`--hidock-server-origin=${encodeURIComponent(origin ?? '')}`] } })
  if (process.platform === 'darwin') app.dock?.setIcon(icon)
  ipcMain.handle('server-connection:get', event => { assertWindow(event); return { origin, error: connectionError } })
  ipcMain.handle('server-connection:connect', (event, value) => { assertWindow(event); switchConnection(validateServerOrigin(value)) })
  ipcMain.handle('hosted-device:call', async (event, operation: unknown, args: unknown) => { assertWindow(event, true); if (typeof operation !== 'string' || !Array.isArray(args)) throw new Error('Invalid native device request.'); return (await nativeRecorder()).call(operation, args) })
  let setupLoad: Promise<void> | undefined
  const showSetup = (): Promise<void> => {
    if (window!.webContents.getURL() === setup) return Promise.resolve()
    // A failed navigation emits did-fail-load and rejects loadURL. Both paths
    // share one setup navigation so they cannot abort each other during startup.
    return setupLoad ??= window!.loadURL(setup).finally(() => { setupLoad = undefined })
  }
  const settings = async () => { if (recorder?.busy) throw new Error('Finish device sync before changing the server.'); await recorder?.close(); await showSetup() }
  const report = (error: unknown) => dialog.showErrorBox('HiDockNotes connection', error instanceof Error ? error.message : 'Could not change the server connection.')
  const loadServer = async (): Promise<void> => {
    if (!origin) return
    // Remove only cached UI, preserving login cookies and unsent recovery drafts.
    await window!.webContents.session.clearStorageData({ origin, storages: ['serviceworkers', 'cachestorage'] })
    await window!.loadURL(origin, { extraHeaders: 'Cache-Control: no-cache\nPragma: no-cache' })
  }
  const openServer = async () => {
    if (recorder?.busy) throw new Error('Finish device sync before reopening the server.')
    if (origin) await loadServer().catch(showSetup)
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { label: 'Server', submenu: [{ label: 'Open server library', enabled: !!origin, click: () => { void openServer().catch(report) } }, { label: 'Change server…', click: () => { void settings().catch(report) } }, { type: 'separator' }, { role: 'quit' }] },
    { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }
  ]))
  // Authentication can visit identity providers. Only the configured origin
  // receives the USB preload and passes native IPC checks.
  window.webContents.on('will-navigate', (event, target) => { try { const url = new URL(target); if (recorder?.busy || url.protocol !== 'https:' && url.origin !== origin) event.preventDefault() } catch { event.preventDefault() } })
  window.webContents.setWindowOpenHandler(({ url }) => url === 'about:blank' || url.startsWith('https://') ? { action: 'allow', overrideBrowserWindowOptions: { webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: undefined } } } : { action: 'deny' })
  window.webContents.on('did-fail-load', (_event, code, _description, url, mainFrame) => {
    if (mainFrame && code !== -3 && url !== setup) {
      connectionError = 'Could not reach your server. Check that it is running and the address is correct, then reconnect.'
      void showSetup().catch(report)
    }
  })
  await (origin ? loadServer() : window.loadURL(setup)).catch(showSetup)
}
app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.show(); window?.focus() })
if (ownsInstance) app.whenReady().then(createWindow).catch(error => { dialog.showErrorBox('Could not open the server', error instanceof Error ? error.message : 'Check the server address.'); app.exit(1) })
app.on('window-all-closed', () => app.quit())
app.on('before-quit', event => {
  if (closed || !ownsInstance) return
  event.preventDefault(); if (stopping) return; stopping = true
  void recorder?.close().catch(error => dialog.showErrorBox('Recorder disconnect', error instanceof Error ? error.message : 'Could not disconnect the recorder.')).finally(() => { closed = true; app.quit() })
  if (!recorder) { closed = true; app.quit() }
})
