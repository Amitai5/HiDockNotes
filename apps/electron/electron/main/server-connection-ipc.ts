import { app, type BrowserWindow } from 'electron'
import { handle } from './ipc/trusted-ipc'
import { readServerConnection, saveServerConnection } from './server-connection'

/** Switch mode through the desktop's existing authenticated main-frame IPC boundary. */
export function registerServerConnection(window: BrowserWindow, phase: () => string): void {
  handle('server-connection:get', () => readServerConnection(app.getPath('userData')))
  const change = (origin: string | null) => {
    if (!['idle', 'disconnected', 'error'].includes(phase())) throw new Error('Finish or cancel the current device operation before switching libraries.')
    if (window.isDestroyed()) throw new Error('The application window is closed.')
    saveServerConnection(app.getPath('userData'), origin)
    setTimeout(() => { app.relaunch(); app.quit() }, 100)
  }
  handle('server-connection:connect', origin => change(origin as string))
  handle('server-connection:local', () => change(null))
}
