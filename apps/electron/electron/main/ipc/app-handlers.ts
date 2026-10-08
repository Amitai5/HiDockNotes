import { app, BrowserWindow, dialog, shell } from 'electron'
import { readFile, writeFile, stat } from 'node:fs/promises'
import { join, basename, extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import product from '../../../product.json'
import { getSettings, saveSettings, listRecordings, getDetail, listProjects, createProject, listActionables, run, markRecordingDownloaded, remeasureRecordingDuration, getRecordingByFilename, renameRecording } from '../services/database'
import { recordingReady } from '../services/recording-events'
import { getRecordingsPath, saveRecording } from '../services/file-storage'
import { getDataPath } from '../services/config'
import { getDevicePipelineService } from '../services/device-pipeline-instance'
import { getActivityLog, clearActivityLog, emitActivityLog } from '../services/activity-log'
import { verifySavedFile } from '../services/file-verification'
import { readWaveform } from '../services/audio-playback'
import { exportTranscript, type TranscriptFormat } from '../services/transcript-export'
import { handle, listen } from './trusted-ipc'
import { validateText, validateBoolean, validateId } from './jensen-validation'
import type { AppSettings } from '../../../src/shared/contracts'

export function readSettings(): AppSettings { return getSettings(join(getDataPath(), 'recordings')) }
export function libraryChanged(): void { for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('library:changed') }
const changed = libraryChanged
export function registerAppHandlers(window: BrowserWindow): void {
  listen('window:minimize', () => window.minimize())
  listen('window:maximize', () => window.isMaximized() ? window.unmaximize() : window.maximize())
  listen('window:close', () => window.close())
  handle('app:info', () => ({ name: product.name, version: product.version, electron: process.versions.electron, platform: process.platform }))
  handle('settings:get', readSettings)
  handle('settings:update', value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid settings.')
    const input = value as Record<string, unknown>
    const patch: Partial<AppSettings> = {}
    for (const key of Object.keys(input)) {
      switch (key) {
        case 'name': patch.name = validateText(input.name, 80); break
        case 'autoConnect': patch.autoConnect = validateBoolean(input.autoConnect); break
        case 'autoDownload': patch.autoDownload = validateBoolean(input.autoDownload); break
        case 'appearance': if (!['light', 'dark', 'system'].includes(String(input.appearance))) throw new Error('Invalid appearance.'); patch.appearance = input.appearance as AppSettings['appearance']; break
        default: throw new Error('Unknown settings field.')
      }
    }
    saveSettings(patch)
    return readSettings()
  })
  handle('storage:choose', async () => {
    if (!['idle', 'disconnected', 'error'].includes(getDevicePipelineService().getState().phase)) throw new Error('Wait for the device operation to finish before changing storage.')
    const result = await dialog.showOpenDialog(window, { title: 'Choose recordings folder', properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || !result.filePaths[0]) return null
    saveSettings({ recordingsPath: result.filePaths[0] }); return readSettings()
  })
  handle('storage:open', async () => { const error = await shell.openPath(getRecordingsPath()); if (error) throw new Error(error) })
  handle('library:list', (search, status) => listRecordings(search === undefined ? '' : validateText(search, 500), status === undefined ? '' : validateText(status, 40)))
  handle('library:detail', id => getDetail(validateId(id)))
  handle('library:rename', (id, title) => { renameRecording(validateId(id), validateText(title, 200)); changed() })
  handle('library:waveform', id => readWaveform(validateId(id)))
  handle('library:import', async () => {
    const result = await dialog.showOpenDialog(window, { title: 'Import recordings', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'm4a', 'flac', 'ogg', 'hda'] }] })
    if (result.canceled) return 0
    let imported = 0
    for (const source of result.filePaths) {
      const metadata = await stat(source)
      if (!metadata.isFile() || metadata.size > 2000000000) throw new Error('Choose an audio file smaller than 2 GB.')
      let filename = basename(source)
      if (getRecordingByFilename(filename)) filename = basename(source, extname(source)) + '-' + randomUUID().slice(0, 8) + extname(source)
      const path = await saveRecording(filename, await readFile(source), undefined, metadata.mtime)
      markRecordingDownloaded(filename, path, { fileSize: metadata.size, dateRecorded: metadata.mtime })
      await verifySavedFile(filename, path, null)
      remeasureRecordingDuration(getRecordingByFilename(filename)!.id)
      recordingReady(getRecordingByFilename(filename)!.id)
      imported++
    }
    emitActivityLog('success', `Imported ${imported} recording${imported === 1 ? '' : 's'}.`); changed(); return imported
  })
  handle('library:export', async id => {
    const detail = getDetail(validateId(id))
    const result = await dialog.showSaveDialog(window, { defaultPath: basename(detail.recording.filename, extname(detail.recording.filename)) + '.md', filters: [{ name: 'Markdown', extensions: ['md'] }, { name: 'Text', extensions: ['txt'] }, { name: 'SubRip subtitles', extensions: ['srt'] }, { name: 'WebVTT subtitles', extensions: ['vtt'] }] })
    if (result.canceled || !result.filePath) return false
    const extension = extname(result.filePath).slice(1).toLowerCase()
    if (!['md', 'txt', 'srt', 'vtt'].includes(extension)) throw new Error('Choose Markdown, TXT, SRT or VTT for the export.')
    await writeFile(result.filePath, exportTranscript(detail, extension as TranscriptFormat), 'utf8'); return true
  })
  handle('projects:list', listProjects)
  handle('projects:create', name => { const text = validateText(name, 80); if (!text) throw new Error('Give the project a name.'); const project = createProject(text); changed(); return project })
  handle('projects:assign', (recording, project) => { run('UPDATE recordings SET project_id=? WHERE id=?', [project === null ? null : validateId(project), validateId(recording)]); changed() })
  handle('actionables:list', listActionables)
  handle('actionables:update', (id, value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid action item.')
    const patch = value as Record<string, unknown>
    if (Object.keys(patch).some(k => k !== 'done' && k !== 'text')) throw new Error('Invalid action item field.')
    if (patch.done !== undefined) run('UPDATE actionables SET done=? WHERE id=?', [Number(validateBoolean(patch.done)), validateId(id)])
    if (patch.text !== undefined) run('UPDATE actionables SET text=? WHERE id=?', [validateText(patch.text, 2000), validateId(id)])
    changed()
  })
  handle('activity-log:list', getActivityLog)
  handle('activity-log:clear', clearActivityLog)
  app.setAboutPanelOptions({ applicationName: product.name, applicationVersion: product.version, copyright: 'MIT · Adapted device protocol © 2025 Sebastian Geraldes' })
}
