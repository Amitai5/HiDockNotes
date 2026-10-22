import { app, BrowserWindow, dialog, Menu, protocol, safeStorage, shell } from 'electron'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import product from '../../product.json'
import { initializeDatabase, closeDatabase, backupBeforeDatabaseMigration } from './services/database'
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
import { setIpcOwner, beginMaintenance } from './ipc/trusted-ipc'
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
import { LibraryRestoreService, applyPendingRestore } from './services/library-restore'
import { registerRestoreHandlers, type MaintenanceRequest } from './ipc/restore-handlers'
import { registerTranscriptHandlers } from './ipc/transcript-handlers'
import { registerUpdateHandlers } from './ipc/update-handlers'
import { SemanticSearch } from './search/semantic-search'
import { UtilityEmbeddingRunner } from './search/embedding-runner'
import { searchModelDirectory } from './search/semantic-model'
import { registerSemanticHandlers } from './ipc/semantic-handlers'
import { CalendarService } from './calendar/calendar-service'
import { parseCalendarInWorker } from './calendar/calendar-worker-runner'
import { registerCalendarHandlers } from './ipc/calendar-handlers'
import type { AssistantConversations } from './services/assistant-conversations'

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
let libraryRestore: LibraryRestoreService | undefined
let semanticSearch: SemanticSearch | undefined
let calendars: CalendarService | undefined
let conversations: AssistantConversations | undefined
let maintenanceAction: (() => Promise<void>) | undefined
let maintenanceFinish: (() => void) | undefined
const requestMaintenance: MaintenanceRequest = (action, finish) => {
  if (shuttingDown || maintenanceAction) throw new Error('The application is already preparing to restart.')
  beginMaintenance('The application is preparing a safety backup and restart.')
  maintenanceAction = action; maintenanceFinish = finish; app.quit()
}
const ownsInstance = app.requestSingleInstanceLock()
if (!ownsInstance) app.quit()
app.on('second-instance', () => {
  if (window?.isMinimized()) window.restore()
  window?.show()
  window?.focus()
})

async function createWindow(): Promise<void> {
  const restored = applyPendingRestore(app.getPath('userData'))
  await backupBeforeDatabaseMigration(join(app.getPath('userData'), 'data', 'library.db'))
  initializeDatabase(join(app.getPath('userData'), 'data', 'library.db'))
  if (restored) emitActivityLog('success', 'Your library was restored. Reconnect AI accounts and review background processing before resuming.')
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
  semanticSearch = new SemanticSearch({ dataPath: app.getPath('userData'), runner: new UtilityEmbeddingRunner(searchModelDirectory(app.getPath('userData'))), changed: state => { if (window && !window.isDestroyed()) window.webContents.send('semantic:state', state) } })
  registerSemanticHandlers(semanticSearch)
  await semanticSearch.initialize()
  recordingEvents.on('changed', () => semanticSearch?.scheduleIndex())
  calendars = new CalendarService({ encryption, parse: parseCalendarInWorker, changed: () => { if (window && !window.isDestroyed()) window.webContents.send('calendar:changed') }, libraryChanged })
  registerCalendarHandlers(calendars, () => shell.openExternal('https://calendar.google.com/calendar/u/0/r/settings'))
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
  const restoreReview = queryOne<{ value: string }>("SELECT value FROM settings WHERE key='restore-review-required'")?.value === 'true'
  transcriptionQueue = new TranscriptionQueue({ vault, reviewMode: restoreReview || process.argv.includes('--review-library'), settings: readAISettings, dataPath: app.getPath('userData'), runner: new UtilityProcessingRunner(profileId => chatgpt.accessToken(profileId)), changed: libraryChanged, activity: emitActivityLog, chatgpt })
  registerTranscriptHandlers(transcriptionQueue, libraryChanged)
  libraryRestore = new LibraryRestoreService({ dataPath: app.getPath('userData'), changed: state => { if (window && !window.isDestroyed()) window.webContents.send('restore:state', state) } })
  registerRestoreHandlers(window, libraryRestore, libraryBackup, requestMaintenance)
  registerUpdateHandlers(window, libraryBackup, requestMaintenance)
  recordingDeletion = new RecordingDeletionService({ dataPath: app.getPath('userData'), device: getDevicePipelineService(), pause: (id, operation) => transcriptionQueue!.withRecordingPaused(id, operation), waitPlayback: waitForPlayback, dismissDownload: filename => { getDownloadService().dismissTerminal(filename) }, changed: libraryChanged })
  registerRecordingControls(recordingDeletion, libraryChanged)
  conversations = registerAIHandlers(transcriptionQueue, vault, providers, libraryChanged, chatgpt, url => shell.openExternal(url), semanticSearch, id => { if (window && !window.isDestroyed()) window.webContents.send('conversations:changed', id) })
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
  calendars.start()
  const pipeline = getDevicePipelineService()
  pipeline.on('state', state => { if (state.phase === 'idle') startRecordingPoll() })
  if (!restoreReview) await pipeline.initAutoConnect().catch(error => emitActivityLog('error', error instanceof Error ? error.message : 'Could not connect to the recorder.'))
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
  recordingEvents.removeAllListeners('changed')
  void Promise.allSettled([pipeline.disconnect(), transcriptionQueue?.stop(), agentAccess?.close(), recordingDeletion?.drain(), libraryBackup?.stop(), semanticSearch?.stop(), calendars?.stop(), conversations?.stop(), maintenanceAction ? undefined : libraryRestore?.stop()]).then(async results => {
    getDownloadService().destroy()
    try {
      if (maintenanceAction) {
        if (results.some(result => result.status === 'rejected')) throw new Error('A background operation could not stop safely. Your current library was kept.')
        await maintenanceAction()
      }
      closeDatabase(); cleaned = true
      if (maintenanceFinish) maintenanceFinish()
      else app.quit()
    } catch (error) {
      dialog.showErrorBox('Could not complete the library operation', error instanceof Error ? error.message : 'Your current library was preserved.')
      closeDatabase(); cleaned = true; app.relaunch(); app.quit()
    }
  })
})
