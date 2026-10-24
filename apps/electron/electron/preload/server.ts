import { contextBridge, ipcRenderer } from 'electron'
const value = process.argv.find(value => value.startsWith('--hidock-server-origin='))?.slice('--hidock-server-origin='.length)
const origin = value ? decodeURIComponent(value) : ''
if (process.isMainFrame && (location.origin === origin || location.protocol === 'file:')) {
  contextBridge.exposeInMainWorld('hidockConnection', { get: () => ipcRenderer.invoke('server-connection:get'), connect: (origin: string) => ipcRenderer.invoke('server-connection:connect', origin), useLocal: () => ipcRenderer.invoke('server-connection:local') })
}
if (process.isMainFrame && location.origin === origin) {
  const subscribe = (channel: string, callback: (value: any) => void) => { const listener = (_event: Electron.IpcRendererEvent, value: unknown) => callback(value); ipcRenderer.on(channel, listener); return () => ipcRenderer.removeListener(channel, listener) }
  contextBridge.exposeInMainWorld('hidockDesktop', { version: 1, call: (operation: string, args: unknown[]) => ipcRenderer.invoke('hosted-device:call', operation, args), onProgress: (callback: (bytes: number) => void) => subscribe('hosted-device:progress', callback), onDetached: (callback: () => void) => subscribe('hosted-device:detached', callback) })
}
