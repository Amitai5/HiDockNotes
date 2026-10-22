import { app, BrowserWindow, dialog, shell } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { join, basename, extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import product from '../../../product.json'
import { getSettings, saveSettings, listRecordings, getDetail, listProjects, createProject, listActionables, markRecordingDownloaded, remeasureRecordingDuration, getRecordingByFilename, renameRecording } from '../services/database'
import { assignRecordingProject, setRecordingTags } from '../services/recording-metadata'
import { recordingEvents, recordingReady } from '../services/recording-events'
import { getRecordingsPath, saveRecording } from '../services/file-storage'
import { getDataPath } from '../services/config'
import { getDevicePipelineService } from '../services/device-pipeline-instance'
import { getActivityLog, clearActivityLog, emitActivityLog } from '../services/activity-log'
import { verifySavedFile } from '../services/file-verification'
import { readWaveform } from '../services/audio-playback'
import { exportFilename, exportNotesFile, exportNotesWithAudio, validateExportOptions } from '../services/recording-export'
import type { TranscriptFormat } from '../../../src/shared/export'
import { updateActionable } from '../services/actionables'
import { handle, listen } from './trusted-ipc'
import { validateText, validateBoolean, validateId } from './jensen-validation'
import { libraryNavigation } from '../services/database'
import type { AppSettings } from '../../../src/shared/contracts'
import { registerClipboardHandler } from './clipboard-handlers'
import { registerReferenceContextHandlers } from './reference-context-handlers'

export function readSettings(): AppSettings { return getSettings(join(getDataPath(), 'recordings')) }
export function libraryChanged(): void { for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('library:changed'); recordingEvents.emit('changed') }
const changed = libraryChanged
export function registerAppHandlers(window: BrowserWindow): void {
  registerClipboardHandler()
  registerReferenceContextHandlers(changed)
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
  handle('library:navigation', libraryNavigation)
  handle('library:rename', (id, title) => { renameRecording(validateId(id), validateText(title, 200)); changed() })
  handle('library:set-tags', (id, tags) => { setRecordingTags(validateId(id), tags); changed() })
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
  handle('library:export', async (id, value) => {
    const detail = getDetail(validateId(id))
    const options = validateExportOptions(value)
    if (options.includeAudio) {
      const target = await dialog.showOpenDialog(window, { title: 'Choose a folder for notes and audio', properties: ['openDirectory', 'createDirectory'] })
      if (target.canceled || !target.filePaths[0]) return false
      await exportNotesWithAudio(detail, target.filePaths[0], options)
      emitActivityLog('success', 'Exported recording notes and verified playable audio.')
      return true
    }
    const formats = [{ name: 'Markdown', extensions: ['md'] }, { name: 'Text', extensions: ['txt'] }, { name: 'SubRip subtitles', extensions: ['srt'] }, { name: 'WebVTT subtitles', extensions: ['vtt'] }]
    const name = exportFilename(detail.recording.title || basename(detail.recording.filename, extname(detail.recording.filename)))
    const result = await dialog.showSaveDialog(window, { defaultPath: name + '.' + options.format, filters: value === undefined ? formats : formats.filter(format => format.extensions.includes(options.format)) })
    if (result.canceled || !result.filePath) return false
    const extension = extname(result.filePath).slice(1).toLowerCase()
    if (!['md', 'txt', 'srt', 'vtt'].includes(extension)) throw new Error('Choose Markdown, TXT, SRT or VTT for the export.')
    if (value !== undefined && extension !== options.format) throw new Error('Use the selected export file format.')
    await exportNotesFile(detail, result.filePath, { ...options, format: extension as TranscriptFormat }); return true
  })
  handle('projects:list', listProjects)
  handle('projects:create', name => { const text = validateText(name, 80); if (!text) throw new Error('Give the project a name.'); const project = createProject(text); changed(); return project })
  handle('projects:assign', (recording, project) => { assignRecordingProject(validateId(recording), project === null ? null : validateId(project)); changed() })
  handle('actionables:list', listActionables)
  handle('actionables:update', (id, value) => {
    updateActionable(validateId(id), value)
    changed()
  })
  handle('activity-log:list', getActivityLog)
  handle('activity-log:clear', clearActivityLog)
  app.setAboutPanelOptions({ applicationName: product.name, applicationVersion: product.version, iconPath: app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(__dirname, '../../resources/icon.png'), copyright: 'MIT · Adapted device protocol © 2025 Sebastian Geraldes' })
}
