import Database from 'better-sqlite3'
import { createWriteStream } from 'node:fs'
import { lstat, mkdtemp, open, realpath, rename, rm, stat, unlink } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import { EMPTY_BACKUP_STATE, type BackupResult, type BackupState } from '../../../src/shared/backup'
import { tarBuffer, tarFile, type ArchivedFile } from './backup-archive'

interface BackupDependencies { database(): Database.Database; dataPath: string; version: string; changed(state: BackupState): void; now?: () => Date }
interface SavedAudio { id: string; filename: string; file_path: string | null; checksum: string | null; verified: number }
function within(parent: string, path: string): boolean { const value = relative(parent, path); return !value || value !== '..' && !value.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) && !isAbsolute(value) }

/** A SQLite snapshot and immutable audio, streamed without blocking the UI or USB. */
export class LibraryBackupService {
  private view: BackupState = { ...EMPTY_BACKUP_STATE }
  private controller: AbortController | null = null
  private task: Promise<BackupResult | null> | null = null
  private publishedAt = 0
  private readonly now: () => Date
  constructor(private readonly dependencies: BackupDependencies) { this.now = dependencies.now ?? (() => new Date()) }
  state(): BackupState { return { ...this.view } }
  get busy(): boolean { return !!this.task }
  create(filePath: string): Promise<BackupResult | null> {
    if (this.task) return Promise.reject(new Error('A backup is already running.'))
    this.controller = new AbortController()
    const task = this.write(filePath, this.controller.signal)
    this.task = task
    void task.finally(() => { if (this.task === task) { this.task = null; this.controller = null } }).catch(() => undefined)
    return task
  }
  cancel(): void { this.controller?.abort() }
  async stop(): Promise<void> { this.cancel(); await this.task?.catch(() => undefined) }
  private publish(patch: Partial<BackupState>, force = true): void {
    this.view = { ...this.view, ...patch }
    if (force || Date.now() - this.publishedAt >= 150) { this.publishedAt = Date.now(); this.dependencies.changed(this.state()) }
  }
  private async write(filePath: string, signal: AbortSignal): Promise<BackupResult | null> {
    let temp: string | undefined, staged: string | undefined, ownsStaged = false
    const createdAt = this.now().toISOString()
    this.publish({ ...EMPTY_BACKUP_STATE, phase: 'snapshot' })
    try {
      const destination = resolve(filePath), parent = await realpath(dirname(destination)), dataPath = await realpath(this.dependencies.dataPath)
      if (!destination.toLowerCase().endsWith('.tar.gz')) throw new Error('Choose a .tar.gz file for the backup.')
      if (within(dataPath, join(parent, basename(destination)))) throw new Error('Save the backup outside the application data folder.')
      signal.throwIfAborted()
      temp = await mkdtemp(join(parent, '.HiDockNotes-backup-'))
      const snapshot = join(temp, 'library.db')
      await this.dependencies.database().backup(snapshot, { progress: ({ totalPages, remainingPages }) => { signal.throwIfAborted(); this.publish({ progress: totalPages ? (1 - remainingPages / totalPages) * 0.05 : 0 }, false); return 128 } })
      signal.throwIfAborted()
      const copy = new Database(snapshot, { readonly: true, fileMustExist: true })
      let recordings: SavedAudio[], counts: Record<string, number>, schema: number, synced: { original_filename: string; file_path: string }[]
      try {
        if (copy.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('The database snapshot failed its integrity check.')
        schema = Number(copy.pragma('user_version', { simple: true }))
        recordings = copy.prepare('SELECT id,filename,file_path,checksum,verified FROM recordings ORDER BY id').all() as SavedAudio[]
        synced = copy.prepare('SELECT original_filename,file_path FROM synced_files').all() as typeof synced
        const tables = copy.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'recording_fts_%'").all() as { name: string }[]
        counts = Object.fromEntries(tables.map(({ name }) => [name, (copy.prepare(`SELECT count(*) AS count FROM "${name.replaceAll('"', '""')}"`).get() as { count: number }).count]))
      } finally { copy.close() }
      const sources: { source: string; archivePath: string }[] = [{ source: snapshot, archivePath: 'data/library.db' }]
      const mapped = new Map<string, string>(), mapping: { recordingId: string | null; deviceFilename: string; originalPath: string | null; archivePath: string | null; expectedSha256: string | null }[] = []
      for (const item of [...recordings.map(row => ({ id: row.id, filename: row.filename, file_path: row.file_path, checksum: row.checksum })), ...synced.map((row, index) => ({ id: null, filename: row.original_filename, file_path: row.file_path, checksum: null, index }))]) {
        signal.throwIfAborted()
        let archivePath: string | null = null
        if (item.file_path) {
          let source: string
          try { source = await realpath(item.file_path); if (!(await stat(source)).isFile()) throw new Error('Not a file') }
          catch { throw new Error(`Cannot read saved audio for "${item.filename}". Restore the file or fix its storage location before backing up.`) }
          if (source === destination || within(temp, source)) throw new Error('Choose a backup destination that is separate from the saved audio.')
          archivePath = mapped.get(source) ?? null
          if (!archivePath) {
            const extension = extname(source).toLowerCase()
            archivePath = `recordings/audio-${sources.length}${/^\.[a-z0-9]{1,10}$/.test(extension) ? extension : '.bin'}`
            sources.push({ source, archivePath }); mapped.set(source, archivePath)
          }
        }
        mapping.push({ recordingId: item.id, deviceFilename: item.filename, originalPath: item.file_path, archivePath, expectedSha256: item.checksum })
      }
      // The agent pairing secret is already encrypted by safeStorage. Include
      // its encrypted bytes without ever reading/decrypting a credential.
      const agentFile = join(dataPath, 'data', 'agent-connection.bin')
      const agent = await lstat(agentFile).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error })
      if (agent) { if (!agent.isFile() || agent.isSymbolicLink()) throw new Error('The agent connection file is not a regular file.'); sources.push({ source: agentFile, archivePath: 'data/agent-connection.bin' }) }
      const totalBytes = (await Promise.all(sources.map(async source => (await stat(source.source)).size))).reduce((sum, bytes) => sum + bytes, 0)
      const files: ArchivedFile[] = []
      this.publish({ phase: 'archiving', progress: 0.05, totalBytes, recordings: recordings.filter(row => !!row.file_path).length })
      const publish = this.publish.bind(this), version = this.dependencies.version
      let completedBytes = 0
      async function* archive(): AsyncGenerator<Buffer> {
        for (const source of sources) yield* tarFile(source.source, source.archivePath, files, signal, bytes => { completedBytes += bytes; publish({ completedBytes, progress: 0.05 + completedBytes / Math.max(1, totalBytes) * 0.94 }, false) })
        const changedAudio = mapping.filter(item => item.expectedSha256 && files.find(file => file.path === item.archivePath)?.sha256 !== item.expectedSha256).length
        publish({ changedAudio })
        const manifest = { format: 'hidocknotes-library-backup', formatVersion: 1, appVersion: version, databaseSchema: schema, createdAt, counts, recordings: mapping, files, changedAudio, credentials: 'encrypted credentials only; reconnect accounts after restore', excluded: ['downloadable AI models', 'rebuildable playback/analysis caches', 'temporary or incomplete downloads', 'application binaries', 'browser session caches'] }
        yield* tarBuffer('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)))
        yield* tarBuffer('README.txt', Buffer.from('HiDockNotes complete library backup\n\nExtract this standard tar.gz archive with Windows Explorer, tar, or an archive utility.\n\ndata/library.db is a consistent SQLite snapshot of ALL application metadata: transcripts, summaries, action items (including completion/dates), projects, tags, settings, voice profiles and embedding samples, saved Assistant conversations/messages/citations, calendar events and recording links, queues and recovery data.\n\nrecordings/ contains original audio bytes, including audio in custom storage folders. manifest.json maps recording IDs and original paths to archive paths and supplies SHA-256 checksums. Recordings which only exist on a disconnected device have metadata but no local audio to include.\n\nAPI keys, subscription credentials and private calendar links remain encrypted with the server key. The key is excluded from this archive; reconnect accounts after restoring. Audio, transcripts and other metadata are private but are NOT encrypted by this archive. Keep it in a trusted location.\n\nModels and caches can be downloaded/regenerated and are excluded. Restore this archive from Settings > Device & storage > Library backup. The app verifies the archive, previews its contents, and saves your current library before restarting with restored audio paths. Reconnect AI accounts, calendars and agents after restoring. Optional meaning search stays disabled until you enable it again.\n'))
        signal.throwIfAborted(); yield Buffer.alloc(1024)
      }
      staged = destination + '.' + randomUUID() + '.partial'
      const output = createWriteStream(staged, { flags: 'wx', mode: 0o600 })
      output.once('open', () => { ownsStaged = true })
      await pipeline(Readable.from(archive()), createGzip({ level: 1 }), output, { signal })
      signal.throwIfAborted()
      const handle = await open(staged, 'r+')
      try { await handle.sync() } finally { await handle.close() }
      signal.throwIfAborted()
      await rename(staged, destination); ownsStaged = false
      const bytes = (await stat(destination)).size
      this.publish({ phase: 'completed', progress: 1, completedBytes: totalBytes, filePath: destination })
      return { filePath: destination, recordings: this.view.recordings, bytes, changedAudio: this.view.changedAudio }
    } catch (error) {
      if (signal.aborted) { this.publish({ phase: 'cancelled', error: null }); return null }
      this.publish({ phase: 'failed', error: error instanceof Error ? error.message : 'Could not create a backup.' })
      throw error
    } finally {
      if (ownsStaged && staged) await unlink(staged).catch(() => undefined)
      // Only the directory returned by mkdtemp belongs to this operation.
      if (temp) await rm(temp, { recursive: true, force: true })
    }
  }
}
