import { app, BrowserWindow, Menu, protocol, safeStorage, shell } from 'electron'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import product from '../../product.json'
import { initializeDatabase, closeDatabase } from './services/database'
import { configureSettingsReader } from './services/config'
import { initializeFileStorage } from './services/file-storage'
import { getDevicePipelineService } from './services/device-pipeline-instance'
import { getDownloadService } from './services/download-service'
import { registerDevicePipelineHandlers } from './ipc/device-pipeline-handlers'
import { registerAppHandlers, readSettings, libraryChanged } from './ipc/app-handlers'
import { registerAIHandlers } from './ipc/ai-handlers'
import { CredentialVault } from './ai/credentials'
import { TranscriptionQueue } from './ai/queue'
import { UtilityProcessingRunner } from './ai/worker-runner'
import { readAISettings, updateAISettings } from './ai/settings'
import { createProvider, providerFactory } from './ai/provider-factory'
import { ChatGPTAuth } from './ai/chatgpt-auth'
import { ChatGPTStore } from './ai/chatgpt-store'
import type { ProviderFactory } from './ai/providers'
import { recordingEvents } from './services/recording-events'
import { setIpcOwner } from './ipc/trusted-ipc'
import { registerMediaProtocol } from './services/media-protocol'
import { startRecordingPoll, stopRecordingPoll } from './ipc/jensen-handlers'
import { registerTruncatedRecoveryHandlers } from './ipc/truncated-recovery-handlers'
import { emitActivityLog } from './services/activity-log'
import { AgentAccessController } from './agents/controller'
import { AgentConnectionStore, connectionFile } from './agents/connection-store'
import { LibraryAgentTools } from './agents/library-tools'
import { agentSetup } from './agents/setup'
import { queryOne, queryAll, run } from './services/database'
import { registerAgentHandlers } from './ipc/agent-handlers'
import { RecordingDeletionService } from './services/recording-deletion'
import { waitForPlayback } from './services/audio-playback'
import { registerRecordingControls } from './ipc/recording-handlers'
import { repairFragmentedSpeakers } from './ai/speaker-repair'
import { repairSavedDecoderArtifacts } from './ai/transcript-repair'
import { registerBackupHandlers } from './ipc/backup-handlers'
import type { LibraryBackupService } from './services/library-backup'

app.setName(product.name)
app.setAppUserModelId(product.appId)
protocol.registerSchemesAsPrivileged([{ scheme: 'app-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }])
let window: BrowserWindow | undefined
let shuttingDown = false
let cleaned = false
let transcriptionQueue: TranscriptionQueue | undefined
let chatgptAuth: ChatGPTAuth | undefined
let agentAccess: AgentAccessController | undefined
let recordingDeletion: RecordingDeletionService | undefined
let libraryBackup: LibraryBackupService | undefined
const ownsInstance = app.requestSingleInstanceLock()
if (!ownsInstance) app.quit()
app.on('second-instance', () => {
  if (window?.isMinimized()) window.restore()
  window?.show()
  window?.focus()
})

async function createWindow(): Promise<void> {
  initializeDatabase(join(app.getPath('userData'), 'data', 'library.db'))
  const artifacts = await repairSavedDecoderArtifacts(app.getPath('userData')).catch(() => { emitActivityLog('warning', 'Saved transcript cleanup was skipped because its safety backup could not be created. Check free disk space.'); return { recordings: 0, segments: 0 } })
  if (artifacts.segments) emitActivityLog('info', `Removed ${artifacts.segments} decoder artifacts from ${artifacts.recordings} saved local transcripts. The original rows and a database backup were retained.`)
  const repaired = repairFragmentedSpeakers()
  if (repaired) emitActivityLog('info', `Repaired fragmented speaker labels in ${repaired} recording${repaired === 1 ? '' : 's'}. Transcript words and timestamps were preserved.`)
  configureSettingsReader(readSettings)
  await initializeFileStorage()
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null)
  window = new BrowserWindow({
    width: 1340, height: 900, minWidth: 980, minHeight: 650, show: false,
    title: product.name, frame: false, backgroundColor: '#fafbfc', icon: app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(__dirname, '../../resources/icon.png'),
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  if (process.platform === 'darwin') app.dock?.setIcon(app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(__dirname, '../../resources/icon.png'))
  setIpcOwner(window)
  registerAppHandlers(window)
  libraryBackup = registerBackupHandlers(window)
  const encryption = { isAvailable: () => safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'), encrypt: (value: string) => safeStorage.encryptString(value), decrypt: (value: Buffer) => safeStorage.decryptString(value) }
  const vault = new CredentialVault(encryption)
  const agentTools = new LibraryAgentTools({ all: queryAll, one: queryOne })
  agentAccess = new AgentAccessController({
    readEnabled: () => queryOne<{ value: string }>("SELECT value FROM settings WHERE key='agent-mcp-enabled'")?.value === 'true',
    saveEnabled: value => { run("INSERT OR REPLACE INTO settings(key,value) VALUES ('agent-mcp-enabled',?)", [JSON.stringify(value)]) },
    store: new AgentConnectionStore(connectionFile(join(app.getPath('userData'), 'data', 'agent-connection.bin')), encryption),
    call: (name, value) => agentTools.call(name, value),
    setup: agentSetup(process.execPath, app.getPath('userData'), process.platform, app.isPackaged ? join(process.resourcesPath, 'mcp-launcher.cjs') : join(__dirname, 'mcp-launcher.js'), app.isPackaged ? undefined : app.getAppPath())
  })
  registerAgentHandlers(agentAccess)
  await agentAccess.start()
  const chatgpt = new ChatGPTAuth({ store: new ChatGPTStore(encryption), appName: product.name, openBrowser: url => shell.openExternal(url), changed: () => { transcriptionQueue?.enqueuePending(); transcriptionQueue?.kick(); libraryChanged() }, sessionEnded: profileId => transcriptionQueue?.invalidateChatGPTSession(profileId), signedIn: models => {
    const current = readAISettings().chat
    const model = current.provider === 'chatgpt' && models.some(item => item.id === current.model) ? current.model : (models.find(item => item.id === 'gpt-6.1-sol') ?? models[0]).id
    updateAISettings({ chat: { provider: 'chatgpt', model } })
  } })
  chatgptAuth = chatgpt
  const providers: ProviderFactory = (provider, key) => {
    if (provider !== 'chatgpt') return createProvider(provider, key)
    const profileId = chatgpt.state().activeProfileId
    return providerFactory(() => chatgpt.accessToken(profileId), message => { if (profileId) chatgpt.block(profileId, message) }, () => chatgpt.sessionSignal(profileId))(provider)
  }
  transcriptionQueue = new TranscriptionQueue({ vault, reviewMode: process.argv.includes('--review-library'), settings: readAISettings, dataPath: app.getPath('userData'), runner: new UtilityProcessingRunner(profileId => chatgpt.accessToken(profileId)), changed: libraryChanged, activity: emitActivityLog, chatgpt })
  recordingDeletion = new RecordingDeletionService({ dataPath: app.getPath('userData'), device: getDevicePipelineService(), pause: (id, operation) => transcriptionQueue!.withRecordingPaused(id, operation), waitPlayback: waitForPlayback, dismissDownload: filename => { getDownloadService().dismissTerminal(filename) }, changed: libraryChanged })
  registerRecordingControls(recordingDeletion, libraryChanged)
  registerAIHandlers(transcriptionQueue, vault, providers, libraryChanged, chatgpt, url => shell.openExternal(url))
  recordingEvents.on('verified', id => transcriptionQueue?.enqueue(id))
  registerDevicePipelineHandlers()
  registerTruncatedRecoveryHandlers()
  registerMediaProtocol()
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => { if (url !== window?.webContents.getURL()) event.preventDefault() })
  window.webContents.on('render-process-gone', (_event, details) => emitActivityLog('error', `Window stopped: ${details.reason}`))
  window.once('ready-to-show', () => window?.show())
  window.on('close', event => {
    if (process.platform === 'darwin' && !shuttingDown) { event.preventDefault(); window?.hide() }
  })
  if (process.env.ELECTRON_RENDERER_URL) await window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else await window.loadFile(join(__dirname, '../renderer/index.html'))
  emitActivityLog('info', `${product.name} is ready.`)
  transcriptionQueue.start()
  const pipeline = getDevicePipelineService()
  pipeline.on('state', state => { if (state.phase === 'idle') startRecordingPoll() })
  await pipeline.initAutoConnect().catch(error => emitActivityLog('error', error instanceof Error ? error.message : 'Could not connect to the recorder.'))
  // Explicit local verification mode, never part of normal app startup.
  if (process.env.HIDOCKNOTES_SCREENSHOT) {
    await new Promise(resolve => setTimeout(resolve, 1000))
    await writeFile(process.env.HIDOCKNOTES_SCREENSHOT, (await window.webContents.capturePage()).toPNG())
  }
}

if (ownsInstance) app.whenReady().then(createWindow).catch(error => {
  console.error('App startup failed:', error instanceof Error ? error.message : String(error))
  app.exit(1)
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (window && !window.isDestroyed()) window.show() })
app.on('before-quit', event => {
  if (cleaned || !ownsInstance) return
  event.preventDefault()
  if (shuttingDown) return
  shuttingDown = true
  chatgptAuth?.close()
  stopRecordingPoll()
  const pipeline = getDevicePipelineService()
  pipeline.removeAutoConnect()
  recordingEvents.removeAllListeners('verified')
  void Promise.allSettled([pipeline.disconnect(), transcriptionQueue?.stop(), agentAccess?.close(), recordingDeletion?.drain(), libraryBackup?.stop()]).then(() => {
    getDownloadService().destroy()
    closeDatabase()
    cleaned = true
    app.quit()
  })
})
