import { app, BrowserWindow, dialog, shell } from 'electron'
import { join } from 'node:path'
import { LibraryBackupService } from '../services/library-backup'
import { getDatabase } from '../services/database'
import { emitActivityLog } from '../services/activity-log'
import product from '../../../product.json'
import { handle } from './trusted-ipc'

export function registerBackupHandlers(window: BrowserWindow): LibraryBackupService {
  const backups = new LibraryBackupService({ database: getDatabase, dataPath: app.getPath('userData'), version: product.version, changed: state => { if (!window.isDestroyed()) window.webContents.send('backup:state', state) } })
  let choosing = false
  handle('backup:get-state', () => backups.state())
  handle('backup:cancel', () => backups.cancel())
  handle('backup:show-file', () => { const path = backups.state().filePath; if (path) shell.showItemInFolder(path) })
  handle('backup:create', async () => {
    if (choosing || backups.busy) throw new Error('A backup is already running.')
    choosing = true
    try {
      const day = new Date().toISOString().replace(/[:.]/g, '-')
      const result = await dialog.showSaveDialog(window, { title: 'Save complete library backup', defaultPath: join(app.getPath('downloads'), `${product.name}-Backup-${day}.tar.gz`), filters: [{ name: 'Complete library backup', extensions: ['tar.gz'] }] })
      if (result.canceled || !result.filePath) return null
      const saved = await backups.create(result.filePath)
      if (saved) emitActivityLog('success', `Saved a complete library backup with ${saved.recordings} local audio recordings.`)
      return saved
    } finally { choosing = false }
  })
  return backups
}
