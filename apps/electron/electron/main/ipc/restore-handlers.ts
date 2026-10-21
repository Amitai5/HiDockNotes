import { app, BrowserWindow, dialog } from 'electron'
import { join } from 'node:path'
import { handle } from './trusted-ipc'
import type { LibraryRestoreService } from '../services/library-restore'
import type { LibraryBackupService } from '../services/library-backup'
import product from '../../../product.json'

export type MaintenanceRequest = (action: () => Promise<void>, finish: () => void) => void
export function registerRestoreHandlers(window: BrowserWindow, restore: LibraryRestoreService, backups: LibraryBackupService, restart: MaintenanceRequest): void {
  let choosing = false
  handle('restore:state', () => restore.state())
  handle('restore:cancel', () => restore.cancel())
  handle('restore:choose', async () => {
    if (choosing || restore.busy || backups.busy) throw new Error('Finish the current backup or restore first.')
    choosing = true
    try {
      const selected = await dialog.showOpenDialog(window, { title: 'Choose a complete library backup', properties: ['openFile'], filters: [{ name: 'HiDockNotes backup', extensions: ['tar.gz'] }] })
      return selected.canceled || !selected.filePaths[0] ? null : await restore.prepare(selected.filePaths[0])
    } finally { choosing = false }
  })
  handle('restore:confirm', async (id, confirmed) => {
    if (confirmed !== true || typeof id !== 'string' || restore.state().preview?.id !== id || restore.state().phase !== 'ready') throw new Error('Confirm the verified backup before restoring it.')
    if (choosing || backups.busy) throw new Error('Finish the current backup first.')
    choosing = true
    try {
      const selected = await dialog.showSaveDialog(window, { title: 'Save your current library before restoring', defaultPath: join(app.getPath('downloads'), `${product.name}-Before-Restore-${Date.now()}.tar.gz`), filters: [{ name: 'Safety backup', extensions: ['tar.gz'] }] })
      if (selected.canceled || !selected.filePath) return false
      const destination = selected.filePath
      restart(async () => {
        const saved = await backups.create(destination)
        if (!saved) throw new Error('The safety backup did not finish. The current library was kept.')
        await restore.schedule(id)
      }, () => { app.relaunch(); app.quit() })
      return true
    } finally { choosing = false }
  })
}
