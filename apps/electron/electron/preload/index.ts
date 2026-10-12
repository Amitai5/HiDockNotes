// Adapted from sgeraldes/hidock-next-2 @ 31d44da (MIT).
/** Device-related preload bridge, isolated from Node and USB in the renderer. */
import { contextBridge, ipcRenderer } from 'electron'
import type { ElectronAPI, Unsubscribe } from '../../src/shared/contracts'

function subscribe<T>(channel: string, callback: (data: T) => void): Unsubscribe {
  const listener = (_event: Electron.IpcRendererEvent, value: T): void => callback(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}
const api: ElectronAPI = {
  app: { info: () => ipcRenderer.invoke('app:info'), minimize: () => ipcRenderer.send('window:minimize'), maximize: () => ipcRenderer.send('window:maximize'), close: () => ipcRenderer.send('window:close'), openRecordingsFolder: () => ipcRenderer.invoke('storage:open') },
  settings: { get: () => ipcRenderer.invoke('settings:get'), update: patch => ipcRenderer.invoke('settings:update', patch), chooseStorage: () => ipcRenderer.invoke('storage:choose') },
  devicePipeline: {
    getState: () => ipcRenderer.invoke('device-pipeline:get-state'), getFiles: () => ipcRenderer.invoke('device-pipeline:get-files'),
    connect: () => ipcRenderer.invoke('device-pipeline:connect'), disconnect: () => ipcRenderer.invoke('device-pipeline:disconnect'), sync: () => ipcRenderer.invoke('device-pipeline:sync'), cancel: () => ipcRenderer.invoke('device-pipeline:cancel'),
    download: filenames => ipcRenderer.invoke('device-pipeline:download', filenames), deleteFile: (filename, confirmed) => ipcRenderer.invoke('device-pipeline:delete', filename, confirmed), syncTime: () => ipcRenderer.invoke('device-pipeline:sync-time'), setAutoRecord: enabled => ipcRenderer.invoke('device-pipeline:auto-record', enabled),
    getDownloads: () => ipcRenderer.invoke('download-service:get-state'), onState: cb => subscribe('device-pipeline:state', cb), onFiles: cb => subscribe('device-pipeline:files', cb), onDownloads: cb => subscribe('download-service:state-update', cb)
  },
  library: { navigation: () => ipcRenderer.invoke('library:navigation'), list: (search, status) => ipcRenderer.invoke('library:list', search, status), detail: id => ipcRenderer.invoke('library:detail', id), rename: (id, title) => ipcRenderer.invoke('library:rename', id, title), waveform: id => ipcRenderer.invoke('library:waveform', id), importAudio: () => ipcRenderer.invoke('library:import'), exportText: (id, options) => ipcRenderer.invoke('library:export', id, options), onChanged: cb => subscribe('library:changed', cb) },
  agents: { state: () => ipcRenderer.invoke('agents:state'), setEnabled: enabled => ipcRenderer.invoke('agents:enabled', enabled), copySetup: target => ipcRenderer.invoke('agents:copy-setup', target) },
  ai: { getState: () => ipcRenderer.invoke('ai:state'), updateSettings: patch => ipcRenderer.invoke('ai:settings', patch), verifyKey: (provider, key) => ipcRenderer.invoke('ai:verify', provider, key), refreshModels: provider => ipcRenderer.invoke('ai:models', provider), removeKey: provider => ipcRenderer.invoke('ai:remove-key', provider), process: id => ipcRenderer.invoke('ai:process', id), processPending: () => ipcRenderer.invoke('ai:process-pending'), chatgpt: { signIn: profileId => ipcRenderer.invoke('chatgpt:sign-in', profileId), cancelSignIn: () => ipcRenderer.invoke('chatgpt:cancel-sign-in'), select: profileId => ipcRenderer.invoke('chatgpt:select', profileId), signOut: profileId => ipcRenderer.invoke('chatgpt:sign-out', profileId), refreshModels: () => ipcRenderer.invoke('chatgpt:models'), acknowledgeWelcome: () => ipcRenderer.invoke('chatgpt:acknowledge-welcome'), manageUsage: () => ipcRenderer.invoke('chatgpt:manage-usage'), resume: () => ipcRenderer.invoke('chatgpt:resume') } },
  voices: { list: () => ipcRenderer.invoke('voices:list'), nameSpeaker: (id, name) => ipcRenderer.invoke('voices:name-speaker', id, name), confirmSpeaker: id => ipcRenderer.invoke('voices:confirm-speaker', id), rename: (id, name) => ipcRenderer.invoke('voices:rename', id, name), merge: (source, target) => ipcRenderer.invoke('voices:merge', source, target), delete: (id, confirmed) => ipcRenderer.invoke('voices:delete', id, confirmed), deleteSample: (id, confirmed) => ipcRenderer.invoke('voices:delete-sample', id, confirmed) },
  assistant: { ask: (question, project, history) => ipcRenderer.invoke('assistant:ask', question, project, history) },
  projects: { list: () => ipcRenderer.invoke('projects:list'), create: name => ipcRenderer.invoke('projects:create', name), assign: (recording, project) => ipcRenderer.invoke('projects:assign', recording, project) },
  actionables: { list: () => ipcRenderer.invoke('actionables:list'), update: (id, patch) => ipcRenderer.invoke('actionables:update', id, patch) },
  activity: { list: () => ipcRenderer.invoke('activity-log:list'), clear: () => ipcRenderer.invoke('activity-log:clear'), onEntry: cb => subscribe('activity-log:entry', cb), onCleared: cb => subscribe('activity-log:cleared', cb) }
}
contextBridge.exposeInMainWorld('electronAPI', api)
