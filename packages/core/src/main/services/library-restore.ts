import Database from 'better-sqlite3'
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync, renameSync, unlinkSync, readFileSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { EMPTY_RESTORE_STATE, type RestoreState, type RestorePreview } from '../../../src/shared/restore'
import { extractVerifiedBackup, type BackupManifest } from './restore-archive'
import { validateDatabaseSchema } from './database'

interface RestoreDependencies { dataPath: string; changed(state: RestoreState): void }
interface RestoreJournal { id: string; directory: string }
/** One verified candidate at a time. The active database stays untouched until a graceful restart. */
export class LibraryRestoreService {
  private view: RestoreState = { ...EMPTY_RESTORE_STATE }
  private directory: string | null = null
  private controller: AbortController | null = null
  private manifest: BackupManifest | null = null
  private task: Promise<RestorePreview | null> | null = null
  constructor(private readonly dependencies: RestoreDependencies) {}
  state(): RestoreState { return { ...this.view } }
  get busy(): boolean { return !!this.task || this.view.phase === 'scheduled' }
  private publish(patch: Partial<RestoreState>): void { this.view = { ...this.view, ...patch }; this.dependencies.changed(this.state()) }
  prepare(path: string): Promise<RestorePreview | null> {
    if (this.busy) return Promise.reject(new Error('A restore is already running.'))
    this.controller = new AbortController()
    const task = this.verify(path, this.controller.signal); this.task = task
    void task.finally(() => { this.task = null; this.controller = null }).catch(() => undefined)
    return task
  }
  async cancel(): Promise<void> {
    if (this.view.phase === 'scheduled') return
    this.controller?.abort(); await this.task?.catch(() => undefined)
    if (this.directory) await rm(this.directory, { recursive: true, force: true })
    this.directory = null; this.manifest = null; this.publish({ ...EMPTY_RESTORE_STATE })
  }
  async stop(): Promise<void> { if (this.view.phase !== 'scheduled') await this.cancel() }
  private async verify(path: string, signal: AbortSignal): Promise<RestorePreview | null> {
    if (this.directory) await rm(this.directory, { recursive: true, force: true })
    this.directory = null; this.manifest = null
    this.publish({ ...EMPTY_RESTORE_STATE, phase: 'verifying' })
    try {
      const parent = join(this.dependencies.dataPath, 'restore-staging'); await mkdir(parent, { recursive: true })
      this.directory = await mkdtemp(join(parent, 'verified-'))
      let last = 0
      const manifest = await extractVerifiedBackup(path, this.directory, signal, bytes => { if (Date.now() - last > 200) { last = Date.now(); this.publish({ completedBytes: bytes }) } })
      const db = new Database(join(this.directory, 'data/library.db'), { readonly: true, fileMustExist: true })
      try {
        db.pragma('trusted_schema=OFF')
        if (db.pragma('integrity_check', { simple: true }) !== 'ok' || (db.pragma('foreign_key_check') as unknown[]).length) throw new Error('The backup database failed its integrity check.')
        validateDatabaseSchema(db)
        if (Number(db.pragma('user_version', { simple: true })) !== manifest.databaseSchema || manifest.databaseSchema < 10) throw new Error('The backup schema does not match its manifest or predates complete library backups.')
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'recording_fts_%'").all() as { name: string }[]
        for (const { name } of tables) {
          const count = (db.prepare(`SELECT count(*) AS count FROM "${name.replaceAll('"', '""')}"`).get() as { count: number }).count
          if (manifest.counts[name] !== count) throw new Error('Backup metadata counts do not match the database.')
        }
        const rows = db.prepare('SELECT id,filename,file_path,checksum FROM recordings').all() as { id: string; filename: string; file_path: string | null; checksum: string | null }[]
        const synced = db.prepare('SELECT original_filename,file_path FROM synced_files').all() as { original_filename: string; file_path: string }[]
        const seen = new Set<string>(), references = new Set<string>()
        for (const mapping of manifest.recordings) {
          if (!mapping || typeof mapping.deviceFilename !== 'string' || mapping.recordingId !== null && typeof mapping.recordingId !== 'string') throw new Error('Invalid recording mapping in backup.')
          const key = mapping.recordingId === null ? `synced:${mapping.deviceFilename}` : `recording:${mapping.recordingId}`
          if (seen.has(key)) throw new Error('Duplicate recording mapping in backup.'); seen.add(key)
          const row = mapping.recordingId === null ? synced.find(item => item.original_filename === mapping.deviceFilename) : rows.find(item => item.id === mapping.recordingId && item.filename === mapping.deviceFilename)
          if (!row || row.file_path !== mapping.originalPath || (!!row.file_path !== !!mapping.archivePath) || mapping.archivePath && !manifest.files.some(file => file.path === mapping.archivePath && file.path.startsWith('recordings/'))) throw new Error('A recording cannot be mapped safely from this backup.')
          if (mapping.recordingId !== null && rows.find(item => item.id === mapping.recordingId)?.checksum !== mapping.expectedSha256) throw new Error('A recording checksum does not match the database.')
          if (mapping.archivePath) references.add(mapping.archivePath)
        }
        if (seen.size !== rows.length + synced.length || manifest.files.some(file => file.path.startsWith('recordings/') && !references.has(file.path))) throw new Error('The backup audio roster is incomplete.')
        this.manifest = manifest
        const preview: RestorePreview = { id: randomUUID(), fileName: basename(path), createdAt: manifest.createdAt, appVersion: manifest.appVersion, counts: manifest.counts, localRecordings: rows.filter(row => !!row.file_path).length, deviceOnly: rows.filter(row => !row.file_path).length, bytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0), changedAudio: manifest.changedAudio }
        this.publish({ phase: 'ready', preview, completedBytes: preview.bytes })
        return preview
      } finally { db.close() }
    } catch (error) {
      if (this.directory) await rm(this.directory, { recursive: true, force: true })
      this.directory = null
      if (signal.aborted) { this.publish({ ...EMPTY_RESTORE_STATE }); return null }
      this.publish({ phase: 'failed', error: error instanceof Error ? error.message : 'The backup could not be verified.' }); throw error
    }
  }
  /** Called only after background services stopped and a complete safety backup succeeded. */
  async schedule(id: string): Promise<void> {
    if (this.view.phase !== 'ready' || this.view.preview?.id !== id || !this.directory || !this.manifest) throw new Error('Verify a backup before restoring it.')
    const destination = join(this.dependencies.dataPath, 'restored', id)
    const db = new Database(join(this.directory, 'data/library.db'))
    try {
      db.transaction(() => {
        for (const item of this.manifest!.recordings) {
          const path = item.archivePath ? join(destination, item.archivePath) : null
          if (item.recordingId !== null) {
            const file = this.manifest!.files.find(file => file.path === item.archivePath)
            db.prepare('UPDATE recordings SET file_path=?,verified=CASE WHEN ?=1 THEN 0 ELSE verified END WHERE id=?').run(path, Number(!!file && !!item.expectedSha256 && file.sha256 !== item.expectedSha256), item.recordingId)
          } else db.prepare('UPDATE synced_files SET file_path=? WHERE original_filename=?').run(path, item.deviceFilename)
        }
        // Restored data must never replay old device deletes, downloads, or AI requests.
        db.prepare("DELETE FROM download_queue").run()
        db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES ('restore-review-required','true')").run()
        db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES ('agent-mcp-enabled','false')").run()
        db.prepare('DELETE FROM provider_credentials').run()
        db.prepare("UPDATE chatgpt_profiles SET ciphertext=NULL,blocked_reason=NULL,logout_warning=NULL").run()
        if (this.manifest!.databaseSchema >= 12) db.prepare('UPDATE calendar_sources SET ciphertext=NULL').run()
        if (this.manifest!.databaseSchema >= 14) {
          // Never restore live login sessions, agent tokens, or queued device deletes.
          db.prepare('DELETE FROM server_sessions').run()
          db.prepare('DELETE FROM server_tokens').run()
          db.prepare('DELETE FROM server_device_commands').run()
          db.prepare("DELETE FROM server_uploads WHERE state<>'completed'").run()
          db.prepare('DELETE FROM server_captures').run()
        }
        db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES ('semantic-enabled','false')").run()
        db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES ('recordingsPath',?)").run(JSON.stringify(join(this.dependencies.dataPath, 'recordings')))
      })()
      db.pragma('wal_checkpoint(TRUNCATE)')
    } finally { db.close() }
    // Rename the owned extraction directory so recovery uses only a generated UUID.
    await mkdir(join(this.dependencies.dataPath, 'restored'), { recursive: true })
    await rename(this.directory, destination); this.directory = null
    const pending = join(this.dependencies.dataPath, 'data', 'restore-pending.json')
    const temporary = pending + '.' + id + '.tmp'
    await writeFile(temporary, JSON.stringify({ id, directory: id } satisfies RestoreJournal), { flag: 'wx', mode: 0o600 })
    await rename(temporary, pending)
    this.publish({ phase: 'scheduled' })
  }
}
/** Crash-recoverable handoff before SQLite, workers, USB, or the renderer open. Keeps the old DB. */
export function applyPendingRestore(dataPath: string): boolean {
  const pending = join(dataPath, 'data', 'restore-pending.json')
  if (!existsSync(pending)) return false
  const journal = JSON.parse(readFileSync(pending, 'utf8')) as RestoreJournal
  if (!/^[0-9a-f-]{36}$/.test(journal.id) || journal.directory !== journal.id) throw new Error('Invalid restore recovery journal.')
  const current = join(dataPath, 'data', 'library.db'), previous = join(dataPath, 'data', `library-before-restore-${journal.id}.db`)
  const staged = join(dataPath, 'restored', journal.id, 'data', 'library.db')
  mkdirSync(join(dataPath, 'data'), { recursive: true })
  if (existsSync(staged)) {
    if (!existsSync(previous) && existsSync(current)) {
      const active = new Database(current, { fileMustExist: true })
      try {
        const checkpoint = active.pragma('wal_checkpoint(TRUNCATE)') as { busy: number }[]
        if (checkpoint.some(item => item.busy)) throw new Error('The current library is still open. Close other applications and retry the restore.')
      } finally { active.close() }
    }
    if (!existsSync(previous) && existsSync(current)) renameSync(current, previous)
    if (existsSync(current)) throw new Error('Restore recovery found an unexpected active database. Both libraries were preserved.')
    try { renameSync(staged, current) } catch (error) { if (existsSync(previous)) renameSync(previous, current); throw error }
  } else if (!existsSync(current) || !existsSync(previous)) throw new Error('The prepared restore database is missing. The previous library was preserved.')
  const agent = join(dataPath, 'data', 'agent-connection.bin')
  if (existsSync(agent)) renameSync(agent, join(dataPath, 'data', `agent-before-restore-${journal.id}.bin`))
  unlinkSync(pending)
  return true
}
