import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
let owner: BrowserWindow | undefined
let maintenance: string | null = null
export function beginMaintenance(reason: string): void { maintenance = reason }
export function setIpcOwner(window: BrowserWindow): void { owner = window }
function assertSender(event: IpcMainInvokeEvent): void {
  if (!owner || event.sender !== owner.webContents || event.senderFrame !== owner.webContents.mainFrame) throw new Error('Untrusted IPC sender.')
}
export function handle(channel: string, fn: (...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => { assertSender(event); if (maintenance) throw new Error(maintenance); return fn(...args) })
}
export function listen(channel: string, fn: () => void): void {
  ipcMain.on(channel, event => { if (owner && event.sender === owner.webContents && event.senderFrame === owner.webContents.mainFrame) fn() })
}
