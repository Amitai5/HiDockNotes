import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import staticFiles from '@fastify/static'
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { readdir, stat, unlink } from 'node:fs/promises'
import { join, resolve, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Readable, pipeline as streamPipeline } from 'node:stream'
import { createGzip } from 'node:zlib'
import { configureDataPath, configureSettingsReader } from '@hidock/core/services/config'
import * as db from '@hidock/core/services/database'
import { configureActivityLog, getActivityLog, clearActivityLog, emitActivityLog } from '@hidock/core/services/activity-log'
import { clearProcedures, handle, invoke } from '@hidock/core/ipc/trusted-ipc'
import { validateId, validateText, validateBoolean } from '@hidock/core/ipc/jensen-validation'
import { CredentialVault } from '@hidock/core/ai/credentials'
import { ChatGPTStore } from '@hidock/core/ai/chatgpt-store'
import { ChatGPTAuth } from '@hidock/core/ai/chatgpt-auth'
import { readAISettings, updateAISettings } from '@hidock/core/ai/settings'
import { providerFactory } from '@hidock/core/ai/provider-factory'
import { UtilityProcessingRunner } from '@hidock/core/ai/worker-runner'
import { TranscriptionQueue } from '@hidock/core/ai/queue'
import { SemanticSearch } from '@hidock/core/search/semantic-search'
import { UtilityEmbeddingRunner } from '@hidock/core/search/embedding-runner'
import { searchModelDirectory } from '@hidock/core/search/semantic-model'
import { CalendarService } from '@hidock/core/calendar/calendar-service'
import { parseCalendarInWorker } from '@hidock/core/calendar/calendar-worker-runner'
import { registerAIHandlers } from '@hidock/core/ipc/ai-handlers'
import { registerTranscriptHandlers } from '@hidock/core/ipc/transcript-handlers'
import { registerCalendarHandlers } from '@hidock/core/ipc/calendar-handlers'
import { registerSemanticHandlers } from '@hidock/core/ipc/semantic-handlers'
import { registerReferenceContextHandlers } from '@hidock/core/ipc/reference-context-handlers'
import { setRecordingTags, assignRecordingProject } from '@hidock/core/services/recording-metadata'
import { readReferenceContext } from '@hidock/core/services/reference-context'
import { updateActionable } from '@hidock/core/services/actionables'
import { preparePlayback, readWaveform, waitForPlayback } from '@hidock/core/services/audio-playback'
import { RecordingDeletionService } from '@hidock/core/services/recording-deletion'
import { LibraryBackupService } from '@hidock/core/services/library-backup'
import { LibraryRestoreService, applyPendingRestore } from '@hidock/core/services/library-restore'
import { validateExportOptions, exportFilename, exportNotesWithAudio } from '@hidock/core/services/recording-export'
import { exportTranscript } from '@hidock/core/services/transcript-export'
import { tarFile } from '@hidock/core/services/backup-archive'
import { LibraryAgentTools } from '@hidock/core/agents/library-tools'
import { AGENT_TOOL_CATALOG } from '@hidock/core/agents/tool-catalog'
import { registerAuth } from './auth'
import { allowedOrigins } from './origins'
import { registerChatGPTCallback } from './chatgpt-callback'
import { digest, encryption, privateFile, secret, setupCode } from './security'
import { registerUploads } from './uploads'
import product from '../product.json'

export interface ServerOptions { dataPath: string; backupPath: string; origin: string; additionalOrigins?: readonly string[]; webPath?: string; secretPath?: string; logger?: boolean; processing?: boolean; onRestore?: () => void; setupLog?: (message: string) => void; chatgpt?: { request?: typeof fetch; callbackPort?: number } }
export async function createApplication(options: ServerOptions) {
  allowedOrigins(options.origin, options.additionalOrigins)
  let maintenance = false
  const dataPath = resolve(options.dataPath), backupPath = resolve(options.backupPath)
  for (const path of [dataPath, backupPath, join(dataPath, 'data'), join(dataPath, 'recordings')]) mkdirSync(path, { recursive: true, mode: 0o700 })
  configureDataPath(dataPath); applyPendingRestore(dataPath)
  db.initializeDatabase(join(dataPath, 'data', 'library.db')); clearProcedures()
  configureSettingsReader(() => db.getSettings(join(dataPath, 'recordings')))
  const key = privateFile(options.secretPath ?? join(dataPath, 'secrets', 'server.key')), cipher = encryption(key)
  const setupFile = join(dataPath, 'secrets', 'setup-code')
  const needsOwner = !db.queryOne('SELECT id FROM server_owner WHERE id=1')
  if (!existsSync(setupFile)) writeFileSync(setupFile, setupCode(), { mode: 0o600, flag: 'wx' })
  else if (needsOwner && !/^[A-HJ-NP-Z2-9]{8}$/.test(readFileSync(setupFile, 'utf8'))) writeFileSync(setupFile, setupCode(), { mode: 0o600 })
  const app = Fastify({ logger: options.logger ? { redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie'], serializers: { req: request => ({ method: request.method, url: request.url.split('?')[0] }) } } : false, bodyLimit: 1024 * 1024, requestTimeout: 120000, trustProxy: false })
  // Install before plugin boot snapshots the route contexts, including when static files are served.
  app.setErrorHandler((error, request, reply) => { app.log.error({ err: error, route: request.routeOptions.url }, 'Request failed'); const code = (error as { statusCode?: number }).statusCode; const status = code && code < 500 ? code : 400; return reply.code(status).send({ error: error instanceof Error ? error.message.slice(0, 500) : 'The request could not be completed.' }) })
  if (needsOwner) { const message = 'HiDockNotes first-run setup. Read /data/secrets/setup-code in the container. Setup code: ' + readFileSync(setupFile, 'utf8'); if (options.setupLog) options.setupLog(message); else if (options.logger) app.log.info(message) }
  await app.register(cookie); await app.register(rateLimit, { global: false })
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_request, body, done) => done(null, body))
  const sessionFor = await registerAuth(app, { origin: options.origin, additionalOrigins: options.additionalOrigins, setupToken: readFileSync(setupFile, 'utf8') })
  app.addHook('preHandler', async (request, reply) => { if (maintenance && request.url.startsWith('/api/')) return reply.code(503).send({ error: 'The server is restarting after restore.' }) })
  const clients = new Set<import('node:http').ServerResponse>()
  const publish = (event: string, value?: unknown): void => { for (const client of clients) client.write('event: ' + event + '\ndata: ' + JSON.stringify(value ?? null) + '\n\n') }
  const changed = (): void => { publish('library:changed'); publish('ai:changed'); search?.scheduleIndex() }
  configureActivityLog(publish)
  const vault = new CredentialVault(cipher), store = new ChatGPTStore(cipher)
  let authUrl: string | null = null
  const openBrowser = async (url: string): Promise<void> => { authUrl = url; publish('browser:open', url) }
  const chatgpt = new ChatGPTAuth({ store, appName: product.name, callbackPort: options.chatgpt?.callbackPort ?? 1455, bindHost: process.env.CHATGPT_CALLBACK_BIND ?? '127.0.0.1', request: options.chatgpt?.request, openBrowser, changed, signedIn: models => { updateAISettings({ chat: { provider: 'chatgpt', model: models[0].id } }); queue.enqueuePending(); queue.kick() }, sessionEnded: id => queue.invalidateChatGPTSession(id) })
  registerChatGPTCallback(app, () => chatgpt.state().signingIn)
  const runner = new UtilityProcessingRunner(id => chatgpt.accessToken(id))
  const queue = new TranscriptionQueue({ vault, settings: readAISettings, dataPath, runner, changed, activity: emitActivityLog, reviewMode: db.queryOne<{ value: string }>("SELECT value FROM settings WHERE key='restore-review-required'")?.value === 'true', chatgpt })
  const search = new SemanticSearch({ dataPath, runner: new UtilityEmbeddingRunner(searchModelDirectory(dataPath)), changed: state => publish('semantic:state', state) })
  const calendar = new CalendarService({ encryption: cipher, parse: parseCalendarInWorker, changed: () => publish('calendar:changed'), libraryChanged: changed })
  const providers = providerFactory(() => chatgpt.accessToken(), message => { const id = store.activeId(); if (id) chatgpt.block(id, message) }, () => chatgpt.sessionSignal(store.activeId()))
  const conversations = registerAIHandlers(queue, vault, providers, changed, chatgpt, openBrowser, search, id => publish('conversations:changed', id))
  registerTranscriptHandlers(queue, changed); registerCalendarHandlers(calendar, async () => undefined); registerSemanticHandlers(search); registerReferenceContextHandlers(changed)
  handle('app:info', () => ({ name: product.name, version: product.version, runtime: process.version, platform: 'web' }))
  handle('settings:get', () => db.getSettings(join(dataPath, 'recordings')))
  handle('settings:update', patch => { if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid settings.'); const value = patch as Record<string, unknown>; for (const [key, item] of Object.entries(value)) { if (key === 'name') validateText(item, 80); else if (key === 'autoConnect' || key === 'autoDownload') validateBoolean(item); else if (key === 'appearance') { if (!['light','dark','system'].includes(String(item))) throw new Error('Choose a valid appearance.') } else throw new Error('Unknown setting.') }; db.saveSettings(value); return db.getSettings(join(dataPath, 'recordings')) })
  handle('library:list', (search = '', status = '') => db.listRecordings(validateText(search, 500), validateText(status, 40)))
  handle('library:detail', id => db.getDetail(validateId(id)))
  handle('library:navigation', () => db.libraryNavigation())
  handle('library:rename', (id, title) => { db.renameRecording(validateId(id), validateText(title, 200)); changed() })
  handle('library:set-tags', (id, tags) => { setRecordingTags(validateId(id), tags); changed() })
  handle('library:waveform', id => { const key = validateId(id); if (db.queryOne('SELECT recording_id FROM recording_deletions WHERE recording_id=?', [key])) throw new Error('The recording is being deleted.'); return readWaveform(key) })
  handle('library:speaker-count', (id, count) => { const key = validateId(id); if (count !== null && (!Number.isInteger(count) || Number(count) < 1 || Number(count) > 10)) throw new Error('Choose 1–10 speakers.'); if (!db.queryOne('SELECT id FROM recordings WHERE id=?', [key])) throw new Error('Recording not found.'); db.run('INSERT INTO recording_overviews(recording_id,expected_speakers) VALUES (?,?) ON CONFLICT(recording_id) DO UPDATE SET expected_speakers=excluded.expected_speakers', [key, count]); changed() })
  handle('projects:list', db.listProjects); handle('projects:create', name => { const text = validateText(name, 80); if (!text) throw new Error('Name your folder.'); const project = db.createProject(text); changed(); return project })
  handle('projects:assign', (id, project) => { assignRecordingProject(validateId(id), project === null ? null : validateId(project)); changed() })
  handle('actionables:list', db.listActionables); handle('actionables:update', (id, patch) => { updateActionable(validateId(id), patch); changed() })
  handle('activity-log:list', getActivityLog); handle('activity-log:clear', clearActivityLog)
  const media = new Map<string, Set<import('node:fs').ReadStream>>()
  const deletion = new RecordingDeletionService({ dataPath, device: { getState: () => ({ phase: 'disconnected', device: null, error: null, scanProgress: null, downloadProgress: null }), deleteFile: async () => null }, pause: (id, action) => queue.withRecordingPaused(id, action), waitPlayback: async id => { for (const stream of media.get(id) ?? []) stream.destroy(); media.delete(id); await waitForPlayback(id) }, dismissDownload: () => undefined, changed, deferDevice: row => { const upload = db.queryOne<{ serial: string; device_filename: string; size: number; checksum: string }>('SELECT * FROM server_uploads WHERE recording_id=? AND serial IS NOT NULL', [row.id]); if (upload) db.run('INSERT OR IGNORE INTO server_device_commands(id,serial,filename,size,checksum,created_at) VALUES (?,?,?,?,?,?)', [randomUUID(), upload.serial, upload.device_filename, upload.size, upload.checksum, new Date().toISOString()]); else if (row.device_serial && row.checksum) db.run('INSERT OR IGNORE INTO server_device_commands(id,serial,filename,size,checksum,created_at) VALUES (?,?,?,?,?,?)', [randomUUID(), row.device_serial, row.filename, row.file_size, row.checksum, new Date().toISOString()]); db.run('DELETE FROM server_uploads WHERE recording_id=?', [row.id]); db.run('DELETE FROM server_captures WHERE recording_id=?', [row.id]) } })
  handle('library:deletion-info', id => deletion.info(validateId(id))); handle('library:delete', (id, confirmed) => deletion.delete(validateId(id), validateBoolean(confirmed)))
  const backups = new LibraryBackupService({ database: db.getDatabase, dataPath, version: product.version, changed: state => publish('backup:state', state) })
  const restore = new LibraryRestoreService({ dataPath, changed: state => publish('restore:state', state) })
  const backup = () => backups.create(join(backupPath, 'HiDockNotes-' + new Date().toISOString().replaceAll(':', '-') + '.tar.gz'))
  handle('backup:get-state', () => backups.state()); handle('backup:create', backup); handle('backup:cancel', () => backups.cancel())
  handle('restore:state', () => restore.state()); handle('restore:cancel', () => restore.cancel())
  handle('restore:confirm', async (id, confirmed) => { if (confirmed !== true || restore.state().preview?.id !== id) throw new Error('Verify and confirm the backup first.'); if (!options.onRestore) throw new Error('Restore requires a managed server restart.'); maintenance = true; try { await conversations.stop(); await queue.stop(); await search.stop(); await calendar.stop(); await deletion.drain(); if (!await backup()) throw new Error('Safety backup was cancelled.'); await restore.schedule(validateId(id)); options.onRestore(); return true } catch (error) { maintenance = false; if (options.processing !== false) { queue.start(); calendar.start(); await search.initialize() }; throw error } })
  await registerUploads(app, dataPath, id => { if (options.processing !== false) queue.enqueue(id); changed() })
  app.get('/healthz', async () => ({ status: maintenance ? 'maintenance' : 'ok', version: product.version }))
  app.post<{ Params: { operation: string }; Body: { args: unknown[] } }>('/api/v1/rpc/:operation', async (request, reply) => { if (maintenance) return reply.code(503).send({ error: 'The library is restarting after restore.' }); if (!Array.isArray(request.body?.args) || request.body.args.length > 8) throw new Error('Invalid operation arguments.'); return { result: await invoke(request.params.operation, request.body.args) ?? null } })
  app.get('/api/v1/chatgpt/authorization', async () => ({ url: authUrl }))
  app.post<{ Body: { url: unknown } }>('/api/v1/chatgpt/callback', { bodyLimit: 24 * 1024, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async request => { await chatgpt.completeCallback(request.body?.url); return { result: queue.state() } })
  app.get('/api/v1/events', async (request, reply) => {
    reply.hijack(); const stream = reply.raw; stream.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }); clients.add(stream); stream.write('event: reconnected\ndata: null\n\n')
    const timer = setInterval(() => { if (!sessionFor(request)) { stream.write('event: signed-out\ndata: null\n\n'); stream.end() } else stream.write(': heartbeat\n\n') }, 15000)
    stream.on('close', () => { clearInterval(timer); clients.delete(stream) })
  })
  app.get<{ Params: { id: string } }>('/api/v1/recordings/:id/audio', async (request, reply) => {
    const id = validateId(request.params.id); if (db.queryOne('SELECT recording_id FROM recording_deletions WHERE recording_id=?', [id])) return reply.code(409).send({ error: 'The recording is being deleted.' }); const file = await preparePlayback(id), info = await stat(file), range = request.headers.range
    let start = 0, end = info.size - 1
    if (range) { const match = /^bytes=(\d*)-(\d*)$/.exec(range); if (!match || !match[1] && !match[2]) return reply.code(416).header('Content-Range', 'bytes */' + info.size).send(); start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2])); end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end; if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) return reply.code(416).header('Content-Range', 'bytes */' + info.size).send(); reply.code(206).header('Content-Range', `bytes ${start}-${end}/${info.size}`) }
    reply.header('Accept-Ranges', 'bytes').header('Content-Type', 'audio/wav').header('Content-Length', end - start + 1)
    const stream = createReadStream(file, { start, end }); const playing = media.get(id) ?? new Set(); playing.add(stream); media.set(id, playing); stream.once('close', () => { playing.delete(stream); if (!playing.size) media.delete(id) }); reply.raw.on('close', () => stream.destroy()); return reply.send(stream)
  })
  app.post<{ Params: { id: string }; Body: unknown }>('/api/v1/recordings/:id/export', async (request, reply) => {
    const detail = db.getDetail(validateId(request.params.id)), value = validateExportOptions(request.body), name = exportFilename(detail.recording.title ?? detail.recording.filename)
    if (detail.deletionPending) throw new Error('The recording is being deleted.')
    if (!value.includeAudio) return reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name + '.' + value.format)}`).type('text/plain; charset=utf-8').send(exportTranscript(detail, value.format, value.content))
    const folder = await exportNotesWithAudio(detail, join(dataPath, 'uploads'), value)
    async function* archive() { try { for (const name of await readdir(folder)) yield* tarFile(join(folder, name), 'recording.' + name.split('.').pop(), [], new AbortController().signal, () => undefined); yield Buffer.alloc(1024) } finally { for (const name of await readdir(folder)) await unlink(join(folder, name)); await import('node:fs/promises').then(fs => fs.rmdir(folder)) } }
    const source = Readable.from(archive()), gzip = createGzip()
    streamPipeline(source, gzip, error => { if (error) gzip.destroy(error) })
    reply.raw.once('close', () => { source.destroy(); gzip.destroy() })
    return reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name + '.tar.gz')}`).type('application/gzip').send(gzip)
  })
  app.get<{ Params: { name: string } }>('/api/v1/backups/:name', async (request, reply) => { const name = request.params.name; if (basename(name) !== name || !/^HiDockNotes-[\w.:-]+\.tar\.gz$/.test(name)) return reply.code(404).send(); return reply.type('application/gzip').header('Content-Disposition', 'attachment; filename="' + name + '"').send(createReadStream(join(backupPath, name))) })
  // Restore archives are streamed separately, bypassing the bounded audio-chunk parser.
  app.register(async child => { child.removeContentTypeParser('application/octet-stream'); child.addContentTypeParser('application/octet-stream', (request, stream, done) => done(null, stream)); child.post('/api/v1/restore/archive', async request => { const path = join(dataPath, 'uploads', randomUUID() + '.tar.gz'); const fs = await import('node:fs'); const { pipeline } = await import('node:stream/promises'); try { let received = 0; async function* bounded() { for await (const part of request.body as Readable) { received += part.length; if (received > 20 * 1024 ** 3) throw new Error('Backups larger than 20 GB must be restored by the server administrator.'); yield part } }; await pipeline(Readable.from(bounded()), fs.createWriteStream(path, { flags: 'wx', mode: 0o600 })); return await restore.prepare(path) } finally { await unlink(path).catch(() => undefined) } }) })
  const agentTools = new LibraryAgentTools({ all: db.queryAll, one: db.queryOne }, { referenceContext: readReferenceContext, meaningSearch: (query, project, signal) => search.agentMatches(query, project, signal) })
  const enabled = () => db.queryOne<{ value: string }>("SELECT value FROM settings WHERE key='agent-mcp-enabled'")?.value === 'true'
  const agentState = () => ({ enabled: enabled(), running: enabled(), error: null, tools: AGENT_TOOL_CATALOG.map(({ name, description }) => ({ name, description })), setup: { other: JSON.stringify({ mcpServers: { hidocknotes: { url: options.origin + '/api/v1/mcp', headers: { Authorization: 'Bearer <create a token below>' } } } }, null, 2), codex: '', claude: '' } })
  handle('agents:state', agentState); handle('agents:enabled', value => { db.run("INSERT OR REPLACE INTO settings VALUES ('agent-mcp-enabled',?)", [String(validateBoolean(value))]); if (!value) db.run('DELETE FROM server_tokens'); return agentState() })
  app.post('/api/v1/mcp/tokens', async () => { const token = secret(); db.run('INSERT INTO server_tokens VALUES (?,?,?)', [digest(token), 'Owner agent', new Date().toISOString()]); return { token } })
  app.post<{ Body: { jsonrpc: string; id?: string | number; method: string; params?: { name?: string; arguments?: unknown } } }>('/api/v1/mcp', async (request, reply) => {
    if (!enabled()) return reply.code(403).send({ error: 'MCP access is disabled.' }); const value = request.body; if (value?.jsonrpc !== '2.0' || typeof value.method !== 'string') return reply.code(400).send({ error: 'Invalid JSON-RPC request.' })
    if (value.method.startsWith('notifications/')) return reply.code(202).send()
    try { const result = value.method === 'initialize' ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: product.name, version: product.version } } : value.method === 'ping' ? {} : value.method === 'tools/list' ? { tools: AGENT_TOOL_CATALOG.map(tool => ({ ...tool, annotations: { readOnlyHint: true, destructiveHint: false } })) } : value.method === 'tools/call' ? { content: [{ type: 'text', text: JSON.stringify(await agentTools.call(value.params?.name ?? '', value.params?.arguments)) }] } : null; return result === null ? { jsonrpc: '2.0', id: value.id, error: { code: -32601, message: 'Method not found.' } } : { jsonrpc: '2.0', id: value.id, result } } catch { return { jsonrpc: '2.0', id: value.id, error: { code: -32602, message: 'Invalid tool arguments or unavailable data.' } } }
  })
  if (options.webPath && existsSync(options.webPath)) { await app.register(staticFiles, { root: resolve(options.webPath), cacheControl: false }); app.setNotFoundHandler((request, reply) => { if (request.url.startsWith('/api/') || request.url.includes('.')) return reply.code(404).send({ error: 'Not found.' }); return reply.sendFile('index.html') }) }
  if (options.processing !== false) { queue.start(); calendar.start(); await search.initialize() }
  const interval = setInterval(() => { if (!maintenance && !backups.busy) void backup().catch(() => emitActivityLog('error', 'Scheduled library backup failed.')) }, 24 * 3600000); interval.unref()
  app.addHook('preClose', async () => { for (const client of clients) client.end(); for (const playing of media.values()) for (const stream of playing) stream.destroy(); chatgpt.close(); await Promise.allSettled([conversations.stop(), queue.stop(), calendar.stop(), search.stop(), backups.stop()]) })
  app.addHook('onClose', async () => { clearInterval(interval); for (const client of clients) client.end(); chatgpt.close(); await conversations.stop(); await queue.stop(); await calendar.stop(); await search.stop(); await backups.stop(); await restore.stop(); await deletion.drain(); db.closeDatabase(); clearProcedures() })
  return app
}
