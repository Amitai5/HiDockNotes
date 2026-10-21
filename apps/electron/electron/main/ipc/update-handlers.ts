import { app, BrowserWindow, dialog, shell } from 'electron'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { AppUpdateService, RELEASES_URL, type InstallerClient, type UpdatePolicy } from '../services/app-updates'
import type { LibraryBackupService } from '../services/library-backup'
import type { MaintenanceRequest } from './restore-handlers'
import product from '../../../product.json'
import type { AppUpdater } from 'electron-updater'
import { handle } from './trusted-ipc'

export function registerUpdateHandlers(window: BrowserWindow, backups: LibraryBackupService, restart: MaintenanceRequest): void {
  let policy: UpdatePolicy = { signed: false, publicKey: '', publisher: '' }
  if (app.isPackaged) {
    try { policy = JSON.parse(readFileSync(join(app.getAppPath(), 'resources', 'update-policy.json'), 'utf8')) as UpdatePolicy }
    catch { /* Older/manual builds can still check releases and open the installer downloads. */ }
  }
  let client: InstallerClient | undefined
  const service = new AppUpdateService({ version: product.version, platform: process.platform, arch: process.arch, packaged: app.isPackaged, appImage: !!process.env.APPIMAGE, policy, client: () => {
    if (!client) {
      // Resolved from the packaged application's production dependencies.
      const module = createRequire(__filename)('electron-updater') as { autoUpdater: AppUpdater }
      client = module.autoUpdater as unknown as InstallerClient
    }
    return client
  }, changed: state => { if (!window.isDestroyed()) window.webContents.send('updates:state', state) } })
  let choosing = false
  handle('updates:state', () => service.state())
  handle('updates:check', () => service.check())
  handle('updates:download', () => service.download())
  handle('updates:open-releases', () => shell.openExternal(RELEASES_URL))
  handle('updates:install', async confirmed => {
    if (confirmed !== true) throw new Error('Confirm the safety backup and update before continuing.')
    if (choosing || backups.busy) throw new Error('Finish the current backup first.')
    if (service.state().phase !== 'downloaded') throw new Error('Download the verified update first.')
    choosing = true
    try {
      const selected = await dialog.showSaveDialog(window, { title: 'Save your library before updating', defaultPath: join(app.getPath('downloads'), `${product.name}-Before-Update-${Date.now()}.tar.gz`), filters: [{ name: 'Complete library backup', extensions: ['tar.gz'] }] })
      if (selected.canceled || !selected.filePath) return false
      const destination = selected.filePath
      service.preparingInstall()
      restart(() => service.prepareInstallation(() => backups.create(destination)), () => service.installAfterBackup())
      return true
    } finally { choosing = false }
  })
}
