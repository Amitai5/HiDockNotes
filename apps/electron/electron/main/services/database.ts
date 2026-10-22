import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readAudioDuration } from './audio-duration'
import type { ActionableView, AppSettings, ProjectView, RecordingDetail, RecordingView } from '../../../src/shared/contracts'
import type { LibraryNavigation } from '../../../src/shared/library'
import type { MeetingOverview } from '../../../src/shared/meeting'
import { legacyMeetingOutcomes } from '../../../src/shared/meeting-outcomes'

export interface Recording { id: string; filename: string; file_path: string | null; file_size: number; date_recorded: string; duration_seconds: number | null; checksum: string | null; verified: number; status: RecordingView['status']; title: string | null; project_id: string | null }
let connection: Database.Database | undefined

const migrations = [
  `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
   CREATE TABLE recordings (id TEXT PRIMARY KEY, filename TEXT NOT NULL UNIQUE, device_serial TEXT, file_path TEXT, file_size INTEGER NOT NULL DEFAULT 0, duration_seconds REAL, date_recorded TEXT NOT NULL, checksum TEXT, verified INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'device-only', title TEXT, project_id TEXT REFERENCES projects(id) ON DELETE SET NULL, created_at TEXT NOT NULL);
   CREATE TABLE transcripts (id TEXT PRIMARY KEY, recording_id TEXT NOT NULL UNIQUE REFERENCES recordings(id) ON DELETE CASCADE, text TEXT NOT NULL DEFAULT '', language TEXT, provider TEXT, model TEXT);
   CREATE TABLE voice_profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
   CREATE TABLE speakers (id TEXT PRIMARY KEY, recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE, label TEXT NOT NULL, voice_profile_id TEXT REFERENCES voice_profiles(id) ON DELETE SET NULL);
   CREATE TABLE segments (id TEXT PRIMARY KEY, recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE, start REAL NOT NULL, end REAL NOT NULL, text TEXT NOT NULL, speaker_id TEXT REFERENCES speakers(id) ON DELETE SET NULL);
   CREATE INDEX segments_recording ON segments(recording_id, start);
   CREATE TABLE voice_samples (id TEXT PRIMARY KEY, voice_profile_id TEXT NOT NULL REFERENCES voice_profiles(id) ON DELETE CASCADE, embedding BLOB NOT NULL, source_recording TEXT REFERENCES recordings(id) ON DELETE SET NULL, created_at TEXT NOT NULL);
   CREATE TABLE summaries (id TEXT PRIMARY KEY, recording_id TEXT NOT NULL UNIQUE REFERENCES recordings(id) ON DELETE CASCADE, text TEXT NOT NULL, template TEXT NOT NULL DEFAULT 'meeting');
   CREATE TABLE actionables (id TEXT PRIMARY KEY, recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE, text TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, start REAL);
   CREATE TABLE synced_files (original_filename TEXT PRIMARY KEY, local_filename TEXT NOT NULL, file_path TEXT NOT NULL, file_size INTEGER NOT NULL, synced_at TEXT NOT NULL);
   CREATE TABLE purge_tombstones (filename TEXT PRIMARY KEY);
   CREATE TABLE download_queue (id TEXT PRIMARY KEY, filename TEXT NOT NULL UNIQUE, file_size INTEGER NOT NULL, progress REAL NOT NULL DEFAULT 0, status TEXT NOT NULL, error TEXT, started_at TEXT, completed_at TEXT, recording_date TEXT, cancel_reason TEXT, created_at TEXT NOT NULL);
   CREATE TABLE device_file_cache (filename TEXT PRIMARY KEY, size INTEGER, dateCreated TEXT);
   CREATE TABLE transcription_jobs (id TEXT PRIMARY KEY, recording_id TEXT NOT NULL UNIQUE REFERENCES recordings(id) ON DELETE CASCADE, stage TEXT NOT NULL DEFAULT 'queued', attempt INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT, error TEXT, created_at TEXT NOT NULL);
   CREATE VIRTUAL TABLE recording_fts USING fts5(recording_id UNINDEXED, filename, title, transcript, summary, tokenize='unicode61');
   CREATE TRIGGER recording_insert AFTER INSERT ON recordings BEGIN INSERT INTO recording_fts(recording_id, filename, title, transcript, summary) VALUES (new.id, new.filename, new.title, '', ''); END;
   CREATE TRIGGER recording_delete AFTER DELETE ON recordings BEGIN DELETE FROM recording_fts WHERE recording_id = old.id; END;
   CREATE TRIGGER recording_update AFTER UPDATE OF filename, title ON recordings BEGIN UPDATE recording_fts SET filename=new.filename, title=new.title WHERE recording_id=new.id; END;
   CREATE TRIGGER transcript_insert AFTER INSERT ON transcripts BEGIN UPDATE recording_fts SET transcript=new.text WHERE recording_id=new.recording_id; END;
   CREATE TRIGGER transcript_update AFTER UPDATE OF text ON transcripts BEGIN UPDATE recording_fts SET transcript=new.text WHERE recording_id=new.recording_id; END;
   CREATE TRIGGER summary_insert AFTER INSERT ON summaries BEGIN UPDATE recording_fts SET summary=new.text WHERE recording_id=new.recording_id; END;
   CREATE TRIGGER summary_update AFTER UPDATE OF text ON summaries BEGIN UPDATE recording_fts SET summary=new.text WHERE recording_id=new.recording_id; END;`,
  `ALTER TABLE recordings ADD COLUMN duration_source TEXT;
   ALTER TABLE device_file_cache ADD COLUMN duration REAL;`,
  `ALTER TABLE recordings ADD COLUMN title_source TEXT;
   UPDATE recordings SET title_source='manual' WHERE title IS NOT NULL;
   CREATE TABLE provider_credentials (provider TEXT PRIMARY KEY, ciphertext BLOB NOT NULL, verified_at TEXT NOT NULL, models TEXT NOT NULL DEFAULT '[]');
   ALTER TABLE transcription_jobs ADD COLUMN progress REAL NOT NULL DEFAULT 0;
   ALTER TABLE transcription_jobs ADD COLUMN message TEXT;
   ALTER TABLE speakers ADD COLUMN embedding BLOB;
   ALTER TABLE speakers ADD COLUMN suggested_profile_id TEXT REFERENCES voice_profiles(id) ON DELETE SET NULL;
   ALTER TABLE speakers ADD COLUMN match_score REAL;
   ALTER TABLE speakers ADD COLUMN label_source TEXT NOT NULL DEFAULT 'automatic';
   ALTER TABLE voice_samples ADD COLUMN speaker_id TEXT REFERENCES speakers(id) ON DELETE SET NULL;
   CREATE UNIQUE INDEX voice_sample_speaker ON voice_samples(voice_profile_id, speaker_id) WHERE speaker_id IS NOT NULL;
   CREATE TRIGGER transcript_delete AFTER DELETE ON transcripts BEGIN UPDATE recording_fts SET transcript='' WHERE recording_id=old.recording_id; END;
   CREATE TRIGGER summary_delete AFTER DELETE ON summaries BEGIN UPDATE recording_fts SET summary='' WHERE recording_id=old.recording_id; END;`,
  `CREATE TABLE chatgpt_profiles (id TEXT PRIMARY KEY, label TEXT NOT NULL, client_id TEXT NOT NULL UNIQUE, issuer TEXT NOT NULL, subject TEXT NOT NULL, email TEXT, name TEXT, ciphertext BLOB, models TEXT NOT NULL DEFAULT '[]', welcome_seen INTEGER NOT NULL DEFAULT 0, blocked_reason TEXT, logout_warning TEXT, created_at TEXT NOT NULL);`,
  `ALTER TABLE transcription_jobs ADD COLUMN summary_pending INTEGER NOT NULL DEFAULT 0;
   UPDATE settings SET value=json_set(value, '$.transcription', json('{"provider":"local","model":"whisper-small"}')) WHERE key='ai' AND json_valid(value);`,
  `ALTER TABLE actionables ADD COLUMN created_at TEXT;
   ALTER TABLE actionables ADD COLUMN due_date TEXT;
   ALTER TABLE actionables ADD COLUMN completed_at TEXT;
   CREATE INDEX actionables_open_due ON actionables(done, due_date);`,
  `CREATE TABLE recording_tags (recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE, tag TEXT NOT NULL, PRIMARY KEY(recording_id, tag));`,
  `CREATE TABLE recording_overviews (recording_id TEXT PRIMARY KEY REFERENCES recordings(id) ON DELETE CASCADE, meeting_type TEXT, participants TEXT, speaker_limited INTEGER NOT NULL DEFAULT 0);
   CREATE INDEX IF NOT EXISTS segments_speaker ON segments(speaker_id);
   ALTER TABLE recording_tags ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
   ALTER TABLE actionables ADD COLUMN owner TEXT;
   ALTER TABLE transcription_jobs ADD COLUMN mode TEXT NOT NULL DEFAULT 'process';
   ALTER TABLE transcription_jobs ADD COLUMN generation TEXT;`,
  `ALTER TABLE recording_overviews ADD COLUMN expected_speakers INTEGER CHECK(expected_speakers BETWEEN 1 AND 10);
   CREATE TABLE recording_deletions (recording_id TEXT PRIMARY KEY REFERENCES recordings(id) ON DELETE CASCADE, device_done INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);`,
  `CREATE TABLE transcript_artifacts (segment_id TEXT PRIMARY KEY, recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE, start REAL NOT NULL, end REAL NOT NULL, text TEXT NOT NULL, speaker_id TEXT, reason TEXT NOT NULL, removed_at TEXT NOT NULL);`,
  `CREATE TABLE transcript_revisions (version INTEGER PRIMARY KEY AUTOINCREMENT, recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE, created_at TEXT NOT NULL, reason TEXT NOT NULL, segment_count INTEGER NOT NULL, segments TEXT NOT NULL, corrections TEXT NOT NULL DEFAULT '[]');
   CREATE INDEX transcript_revisions_recording ON transcript_revisions(recording_id, version);
   CREATE TABLE transcript_corrections (recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE, segment_id TEXT NOT NULL, start REAL NOT NULL, end REAL NOT NULL, text TEXT NOT NULL, PRIMARY KEY(recording_id,segment_id));
   CREATE TABLE transcript_candidates (recording_id TEXT PRIMARY KEY REFERENCES recordings(id) ON DELETE CASCADE, created_at TEXT NOT NULL, checkpoint TEXT NOT NULL, settings TEXT NOT NULL);
   ALTER TABLE recording_overviews ADD COLUMN summary_version INTEGER NOT NULL DEFAULT 0;`,
  `CREATE TABLE assistant_conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, title_manual INTEGER NOT NULL DEFAULT 0, project_id TEXT REFERENCES projects(id) ON DELETE SET NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, draft TEXT NOT NULL DEFAULT '');
   CREATE INDEX assistant_conversations_updated ON assistant_conversations(updated_at DESC);
   CREATE TABLE assistant_messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE, ordinal INTEGER NOT NULL, role TEXT NOT NULL CHECK(role IN ('user','assistant')), content TEXT NOT NULL, citations TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(citations)), created_at TEXT NOT NULL, UNIQUE(conversation_id,ordinal));
   CREATE TRIGGER assistant_source_deleted BEFORE DELETE ON recordings BEGIN
     UPDATE assistant_conversations SET version=version+1 WHERE id IN (SELECT m.conversation_id FROM assistant_messages m,json_each(m.citations) c WHERE json_extract(c.value,'$.recordingId')=old.id);
     UPDATE assistant_messages SET content='This answer was removed because a source recording was deleted.',citations='[]' WHERE id IN (SELECT m.id FROM assistant_messages m,json_each(m.citations) c WHERE json_extract(c.value,'$.recordingId')=old.id);
   END;
   CREATE TABLE semantic_documents (recording_id TEXT PRIMARY KEY REFERENCES recordings(id) ON DELETE CASCADE, fingerprint TEXT NOT NULL, model TEXT NOT NULL, indexed_at TEXT NOT NULL);
   CREATE TABLE semantic_chunks (id INTEGER PRIMARY KEY, recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE, position INTEGER NOT NULL, start REAL NOT NULL, end REAL NOT NULL, text TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('transcript','summary')), embedding BLOB NOT NULL, UNIQUE(recording_id,position));
   CREATE INDEX semantic_chunks_recording ON semantic_chunks(recording_id);
   CREATE TABLE calendar_sources (id TEXT PRIMARY KEY, name TEXT NOT NULL, feed_hash TEXT NOT NULL UNIQUE, ciphertext BLOB, last_synced_at TEXT, error TEXT, created_at TEXT NOT NULL);
   CREATE TABLE calendar_events (id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES calendar_sources(id) ON DELETE CASCADE, event_key TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, location TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL, all_day INTEGER NOT NULL DEFAULT 0, organizer TEXT, invitees TEXT NOT NULL DEFAULT '[]', cancelled INTEGER NOT NULL DEFAULT 0, available INTEGER NOT NULL DEFAULT 1, UNIQUE(source_id,event_key));
   CREATE INDEX calendar_events_start ON calendar_events(start,end);
   CREATE TABLE recording_calendar (recording_id TEXT PRIMARY KEY REFERENCES recordings(id) ON DELETE CASCADE, event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE);
   CREATE TRIGGER semantic_transcript_updated AFTER UPDATE OF text ON transcripts BEGIN DELETE FROM semantic_documents WHERE recording_id=new.recording_id; END;
   CREATE TRIGGER semantic_transcript_inserted AFTER INSERT ON transcripts BEGIN DELETE FROM semantic_documents WHERE recording_id=new.recording_id; END;
   CREATE TRIGGER semantic_transcript_deleted AFTER DELETE ON transcripts BEGIN DELETE FROM semantic_documents WHERE recording_id=old.recording_id; END;
   CREATE TRIGGER semantic_title_updated AFTER UPDATE OF title,filename ON recordings BEGIN DELETE FROM semantic_documents WHERE recording_id=new.id; END;
   CREATE TRIGGER semantic_summary_updated AFTER UPDATE OF text ON summaries BEGIN DELETE FROM semantic_documents WHERE recording_id=new.recording_id; END;
   CREATE TRIGGER semantic_summary_inserted AFTER INSERT ON summaries BEGIN DELETE FROM semantic_documents WHERE recording_id=new.recording_id; END;
   CREATE TRIGGER semantic_summary_deleted AFTER DELETE ON summaries BEGIN DELETE FROM semantic_documents WHERE recording_id=old.recording_id; END;
   CREATE TRIGGER semantic_speaker_updated AFTER UPDATE OF label ON speakers BEGIN DELETE FROM semantic_documents WHERE recording_id=new.recording_id; END;`,
  `ALTER TABLE summaries ADD COLUMN outcomes TEXT CHECK(outcomes IS NULL OR (json_valid(outcomes) AND json_type(outcomes)='array'));`
]

export const DATABASE_SCHEMA_VERSION = migrations.length
/** Keeps an untouched SQLite recovery point before a manual install migrates metadata. */
export async function backupBeforeDatabaseMigration(filePath: string): Promise<void> {
  if (!existsSync(filePath)) return
  const database = new Database(filePath, { readonly: true, fileMustExist: true })
  try {
    const version = Number(database.pragma('user_version', { simple: true }))
    if (version > 0 && version < DATABASE_SCHEMA_VERSION) await database.backup(filePath + `.before-schema-${DATABASE_SCHEMA_VERSION}-${randomUUID()}.db`)
  } finally { database.close() }
}
/** Refuses executable/schema additions in imported SQLite files before using them. */
export function validateDatabaseSchema(database: Database.Database): void {
  const version = Number(database.pragma('user_version', { simple: true }))
  if (!Number.isInteger(version) || version < 1 || version > migrations.length) throw new Error('This backup needs a different application version.')
  const reference = new Database(':memory:')
  try {
    for (const migration of migrations.slice(0, version)) reference.exec(migration)
    const schema = (db: Database.Database): string => JSON.stringify(db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all())
    if (schema(database) !== schema(reference)) throw new Error('The backup database schema is not recognized.')
  } finally { reference.close() }
}

export function initializeDatabase(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true })
  connection = new Database(filePath)
  connection.pragma('journal_mode = WAL')
  connection.pragma('foreign_keys = ON')
  const version = Number(connection.pragma('user_version', { simple: true }))
  if (version > migrations.length) throw new Error('This database was created by a newer app version.')
  for (let index = version; index < migrations.length; index++) {
    connection.transaction(() => {
      getDatabase().exec(migrations[index])
      if (index === 12) {
        // Preserve legacy outcome sections as summary-derived data. Updating only
        // metadata leaves notes, transcript revisions and semantic caches intact.
        const update = getDatabase().prepare('UPDATE summaries SET outcomes=? WHERE recording_id=?')
        for (const summary of queryAll<{ recording_id: string; text: string }>('SELECT recording_id,text FROM summaries')) update.run(JSON.stringify(legacyMeetingOutcomes(summary.text)), summary.recording_id)
      }
      getDatabase().pragma(`user_version = ${index + 1}`)
    })()
  }
}
export function getDatabase(): Database.Database { if (!connection) throw new Error('Database is not initialized.'); return connection }
export function closeDatabase(): void { connection?.close(); connection = undefined }
export function queryOne<T>(sql: string, params: unknown[] = []): T | undefined { return getDatabase().prepare(sql).get(...params) as T | undefined }
export function queryAll<T>(sql: string, params: unknown[] = []): T[] { return getDatabase().prepare(sql).all(...params) as T[] }
export function run(sql: string, params: unknown[] = []): Database.RunResult { return getDatabase().prepare(sql).run(...params) }
export function runInTransaction<T>(fn: () => T): T { return getDatabase().transaction(fn)() }
export function upsertRecordingFromDevice(file: { filename: string; size: number; duration: number; dateCreated: Date }): Recording {
  run('INSERT INTO recordings(id, filename, file_size, duration_seconds, date_recorded, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(filename) DO UPDATE SET file_size=CASE WHEN recordings.verified=0 THEN excluded.file_size ELSE recordings.file_size END, duration_seconds=COALESCE(recordings.duration_seconds, excluded.duration_seconds)', [randomUUID(), file.filename, file.size, file.duration, file.dateCreated.toISOString(), new Date().toISOString()])
  return getRecordingByFilename(file.filename)!
}
export function getRecordingByFilename(filename: string): Recording | undefined { return queryOne<Recording>('SELECT * FROM recordings WHERE filename = ?', [filename]) }
export function markRecordingDownloaded(filename: string, localPath: string, meta: { fileSize?: number; dateRecorded?: Date | string } = {}): string {
  const rec = getRecordingByFilename(filename) ?? upsertRecordingFromDevice({ filename, size: meta.fileSize ?? 0, duration: 0, dateCreated: meta.dateRecorded ? new Date(meta.dateRecorded) : new Date() })
  run("UPDATE recordings SET file_path=?, file_size=?, status='downloaded', verified=0 WHERE id=?", [localPath, meta.fileSize ?? rec.file_size, rec.id])
  return rec.id
}
export function markRecordingVerified(filename: string, checksum: string, serial: string | null): void { run('UPDATE recordings SET checksum=?, verified=1, device_serial=? WHERE filename=?', [checksum, serial, filename]) }
export function addSyncedFile(original: string, local: string, localPath: string, size = 0): void { run('INSERT OR REPLACE INTO synced_files VALUES (?, ?, ?, ?, ?)', [original, local, localPath, size, new Date().toISOString()]) }
export function getSyncedFile(filename: string): { file_path: string; file_size: number } | undefined { return queryOne('SELECT * FROM synced_files WHERE original_filename=?', [filename]) }
export function removeSyncedFile(filename: string): void { run('DELETE FROM synced_files WHERE original_filename=?', [filename]) }
export function getSyncedFilenames(): Set<string> { return new Set(queryAll<{ original_filename: string }>('SELECT original_filename FROM synced_files').map(r => r.original_filename)) }
export function isFilePurged(filename: string): boolean { return Boolean(queryOne('SELECT filename FROM purge_tombstones WHERE filename=?', [filename])) }
export function getPurgedFilenames(): string[] { return queryAll<{ filename: string }>('SELECT filename FROM purge_tombstones').map(r => r.filename) }
export function clearPurgeTombstones(filename: string): number { return run('DELETE FROM purge_tombstones WHERE filename=?', [filename]).changes }
export function remeasureRecordingDuration(id: string): { seconds: number; truncated: boolean } | null {
  const rec = queryOne<Recording>('SELECT * FROM recordings WHERE id=?', [id]); if (!rec?.file_path) return null
  const duration = readAudioDuration(rec.file_path); if (!duration) return null
  const end = queryOne<{ end: number | null }>('SELECT max(end) AS end FROM segments WHERE recording_id=?', [id])?.end ?? 0
  const truncated = end > duration.seconds + 1
  if (!truncated) run("UPDATE recordings SET duration_seconds=?, duration_source='file' WHERE id=?", [duration.seconds, id])
  return { seconds: duration.seconds, truncated }
}
export function findTruncatedRecordings(): { id: string; filename: string; filePath: string }[] {
  return queryAll<{ id: string; filename: string; filePath: string; end: number }>('SELECT r.id, r.filename, r.file_path AS filePath, max(s.end) AS end FROM recordings r JOIN segments s ON s.recording_id=r.id WHERE r.file_path IS NOT NULL GROUP BY r.id').filter(r => { const measured = readAudioDuration(r.filePath); return !!measured && r.end > measured.seconds + 1 }).map(({ id, filename, filePath }) => ({ id, filename, filePath }))
}
export function getSettings(defaultFolder: string): AppSettings {
  const rows = queryAll<{ key: string; value: string }>("SELECT key, value FROM settings WHERE key IN ('name','autoConnect','autoDownload','appearance','recordingsPath')")
  const values = Object.fromEntries(rows.map(r => [r.key, JSON.parse(r.value) as unknown]))
  return { name: typeof values.name === 'string' ? values.name : '', autoConnect: values.autoConnect !== false, autoDownload: values.autoDownload !== false, appearance: values.appearance === 'dark' || values.appearance === 'system' ? values.appearance : 'light', recordingsPath: typeof values.recordingsPath === 'string' ? values.recordingsPath : defaultFolder }
}
export function saveSettings(patch: Partial<AppSettings>): void { runInTransaction(() => { for (const [key, value] of Object.entries(patch)) run('INSERT OR REPLACE INTO settings VALUES (?, ?)', [key, JSON.stringify(value)]) }) }
export function listRecordings(search = '', status = ''): RecordingView[] {
  const terms = search.trim().split(/\s+/).filter(Boolean).map(t => '"' + t.replaceAll('"', '""') + '"*').join(' AND ')
  const params: unknown[] = []
  let sql = 'SELECT r.*, s.text AS summary, j.message AS processingMessage, j.progress AS processingProgress, j.mode AS processingMode FROM recordings r LEFT JOIN summaries s ON s.recording_id=r.id LEFT JOIN transcription_jobs j ON j.recording_id=r.id WHERE 1=1'
  if (terms) { sql += ' AND r.id IN (SELECT recording_id FROM recording_fts WHERE recording_fts MATCH ?)'; params.push(terms) }
  if (status) { sql += ' AND r.status=?'; params.push(status) }
  sql += ' ORDER BY r.date_recorded DESC'
  const positions = new Map(queryAll<{ recording_id: string }>("SELECT recording_id FROM transcription_jobs WHERE stage='queued' ORDER BY COALESCE(next_attempt_at,created_at),created_at").map((job, index) => [job.recording_id, index + 1]))
  return queryAll<Recording & { summary: string | null; processingMessage: string | null; processingProgress: number | null; processingMode: RecordingView['processingMode'] }>(sql, params).map(r => ({ id: r.id, filename: r.filename, title: r.title, recordedAt: r.date_recorded, duration: r.duration_seconds, size: r.file_size, status: r.status, verified: r.verified === 1, hasAudio: r.file_path !== null, projectId: r.project_id, summary: r.summary, queuePosition: positions.get(r.id) ?? null, processingMessage: r.processingMessage, processingProgress: r.processingProgress, processingMode: r.processingMode }))
}
export function getDetail(id: string): RecordingDetail {
  const recording = listRecordings().find(r => r.id === id); if (!recording) throw new Error('Recording was not found.')
  const overview = queryOne<{ meeting_type: string | null; participants: string | null; speaker_limited: number }>('SELECT meeting_type,participants,speaker_limited FROM recording_overviews WHERE recording_id=?', [id])
  const meeting: MeetingOverview | null = overview?.meeting_type ? { meetingType: overview.meeting_type, participants: overview.participants ? JSON.parse(overview.participants) : [] } : null
  if (meeting) {
    const manual = new Map(queryAll<{ id: string; label: string }>("SELECT id,label FROM speakers WHERE recording_id=? AND label_source='manual'", [id]).map(speaker => [speaker.id, speaker.label]))
    meeting.participants = meeting.participants.map(person => person.speakerId && manual.has(person.speakerId) ? { ...person, name: manual.get(person.speakerId)! } : person)
  }
  return { recording, meeting, expectedSpeakers: queryOne<{ expected_speakers: number | null }>('SELECT expected_speakers FROM recording_overviews WHERE recording_id=?', [id])?.expected_speakers ?? null, deletionPending: !!queryOne('SELECT recording_id FROM recording_deletions WHERE recording_id=?', [id]), speakerLimitReached: overview?.speaker_limited === 1, tags: queryAll<{ tag: string }>('SELECT tag FROM recording_tags WHERE recording_id=? ORDER BY rowid', [id]).map(row => row.tag), segments: queryAll('SELECT s.id, s.start, s.end, s.text, s.speaker_id AS speakerId, p.label AS speakerName FROM segments s LEFT JOIN speakers p ON p.id=s.speaker_id WHERE s.recording_id=? ORDER BY s.start', [id]), actionables: listActionables().filter(a => a.recordingId === id),
    processing: queryOne('SELECT stage, progress, message, error, attempt, mode, next_attempt_at AS nextAttemptAt FROM transcription_jobs WHERE recording_id=?', [id]),
    speakers: queryAll<{ id: string; label: string; profileId: string | null; suggestedProfileId: string | null; suggestedName: string | null; score: number | null; canRemember: number }>('SELECT s.id, s.label, s.voice_profile_id AS profileId, s.suggested_profile_id AS suggestedProfileId, p.name AS suggestedName, s.match_score AS score, s.embedding IS NOT NULL AS canRemember FROM speakers s LEFT JOIN voice_profiles p ON p.id=s.suggested_profile_id WHERE s.recording_id=? AND EXISTS(SELECT 1 FROM segments t WHERE t.speaker_id=s.id) ORDER BY s.rowid', [id]).map(s => ({ ...s, canRemember: !!s.canRemember })) }
}
export function renameRecording(id: string, title: string): void {
  const name = title.trim()
  if (!name || name.length > 200 || /[\u0000-\u001f]/.test(name)) throw new Error('Use a recording title between 1 and 200 characters.')
  if (!run("UPDATE recordings SET title=?, title_source='manual' WHERE id=?", [name, id]).changes) throw new Error('Recording was not found.')
}
export function listProjects(): ProjectView[] { return queryAll('SELECT p.id, p.name, count(r.id) AS count FROM projects p LEFT JOIN recordings r ON r.project_id=p.id GROUP BY p.id ORDER BY p.name') }
export function libraryNavigation(): LibraryNavigation {
  const recordings = queryAll<{ id: string; filename: string; title: string | null; projectId: string | null }>('SELECT id, filename, title, project_id AS projectId FROM recordings ORDER BY date_recorded DESC, id')
  const projectRecordings: NonNullable<LibraryNavigation['projectRecordings']> = {}
  const looseRecordings: LibraryNavigation['looseRecordings'] = []
  for (const { projectId, ...recording } of recordings) {
    if (projectId) (projectRecordings[projectId] ??= []).push(recording)
    else looseRecordings.push(recording)
  }
  return { projects: listProjects(), looseRecordings, projectRecordings }
}
export function createProject(name: string): ProjectView { const id = randomUUID(); run('INSERT INTO projects VALUES (?, ?, ?)', [id, name, new Date().toISOString()]); return { id, name, count: 0 } }
export function listActionables(): ActionableView[] { return queryAll<Omit<ActionableView, 'done'> & { done: number }>('SELECT id, text, done, recording_id AS recordingId, start, owner, created_at AS createdAt, due_date AS dueDate, completed_at AS completedAt FROM actionables ORDER BY done, due_date IS NULL, due_date, rowid DESC').map(a => ({ ...a, done: a.done === 1 })) }
