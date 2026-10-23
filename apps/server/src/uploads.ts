import { randomUUID } from 'node:crypto'
import { mkdir, open, rename, stat, unlink } from 'node:fs/promises'
import { join, basename, extname } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { hashFile } from '@hidock/core/services/file-verification'
import { queryAll, queryOne, run, runInTransaction, markRecordingDownloaded, markRecordingVerified, remeasureRecordingDuration } from '@hidock/core/services/database'
interface Upload { id: string; filename: string; size: number; offset: number; checksum: string; serial: string | null; device_filename: string | null; recorded_at: string; state: string; recording_id: string | null }
const CHUNK = 1024 * 1024
export async function registerUploads(app: FastifyInstance, dataPath: string, ready: (id: string) => void): Promise<void> {
  const folder = join(dataPath, 'uploads'), recordings = join(dataPath, 'recordings'); await mkdir(folder, { recursive: true }); await mkdir(recordings, { recursive: true })
  const busy = new Set<string>()
  const locked = async <T>(id: string, action: () => Promise<T>): Promise<T> => { if (busy.has(id)) throw new Error('This upload is busy. Retry its current offset.'); busy.add(id); try { return await action() } finally { busy.delete(id) } }
  const get = (id: string): Upload => { if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid upload ID.'); const item = queryOne<Upload>('SELECT * FROM server_uploads WHERE id=?', [id]); if (!item) throw new Error('Upload not found.'); return item }
  app.post<{ Body: { filename: string; size: number; checksum: string; serial?: string; deviceFilename?: string; recordedAt?: string } }>('/api/v1/uploads', async request => {
    const value = request.body
    if (!value || typeof value.filename !== 'string' || basename(value.filename) !== value.filename || !/\.(wav|hda|mp3|m4a|mp4|webm|ogg|flac|aac|opus)$/i.test(value.filename) || value.filename.length > 200 || !Number.isSafeInteger(value.size) || value.size < 1 || value.size > 2 * 1024 ** 3 || !/^[a-f0-9]{64}$/.test(value.checksum)) throw new Error('Choose an audio file up to 2 GB with a SHA-256 checksum.')
    if (value.serial !== undefined && (typeof value.serial !== 'string' || !/^[\w-]{1,100}$/.test(value.serial) || value.deviceFilename !== value.filename)) throw new Error('Invalid recorder identity.')
    const recorded = value.recordedAt ? new Date(value.recordedAt) : new Date(); if (!Number.isFinite(recorded.getTime())) throw new Error('Invalid recording date.')
    const previous = queryOne<Upload>("SELECT * FROM server_uploads WHERE checksum=? AND size=? AND coalesce(serial,'')=? AND filename=? AND state IN ('uploading','completed') ORDER BY created_at DESC LIMIT 1", [value.checksum, value.size, value.serial ?? '', value.filename]); if (previous) return previous
    const id = randomUUID(); const file = await open(join(folder, id), 'wx', 0o600); await file.close()
    run('INSERT INTO server_uploads(id,filename,size,checksum,serial,device_filename,recorded_at,created_at) VALUES (?,?,?,?,?,?,?,?)', [id, value.filename, value.size, value.checksum, value.serial ?? null, value.deviceFilename ?? null, recorded.toISOString(), Date.now()]); return get(id)
  })
  app.get<{ Params: { id: string } }>('/api/v1/uploads/:id', async request => get(request.params.id))
  app.put<{ Params: { id: string }; Querystring: { offset: string }; Body: Buffer }>('/api/v1/uploads/:id', { bodyLimit: CHUNK }, async (request, reply) => locked(request.params.id, async () => {
    const value = get(request.params.id), offset = Number(request.query.offset), chunk = request.body
    if (value.state !== 'uploading' || !Buffer.isBuffer(chunk) || !chunk.length || chunk.length > CHUNK || !Number.isSafeInteger(offset) || offset !== value.offset || offset + chunk.length > value.size) return reply.code(409).send({ error: 'Resume from the committed offset.', offset: value.offset })
    const file = await open(join(folder, value.id), 'r+'); try { await file.truncate(offset); let written = 0; while (written < chunk.length) { const result = await file.write(chunk, written, chunk.length - written, offset + written); if (!result.bytesWritten) throw new Error('Upload storage is full.'); written += result.bytesWritten }; await file.sync() } finally { await file.close() }
    run('UPDATE server_uploads SET offset=? WHERE id=?', [offset + chunk.length, value.id]); return get(value.id)
  }))
  app.post<{ Params: { id: string } }>('/api/v1/uploads/:id/complete', async request => locked(request.params.id, async () => {
    const value = get(request.params.id); if (value.state === 'completed') return value
    if (value.offset !== value.size) throw new Error('Upload the complete audio before finishing.')
    const filename = value.id + extname(value.filename).toLowerCase(), destination = join(recordings, filename), staged = join(folder, value.id)
    const source = await stat(destination).then(() => destination).catch(() => staged)
    if (await hashFile(source) !== value.checksum) { run("UPDATE server_uploads SET state='failed' WHERE id=?", [value.id]); throw new Error('The uploaded audio checksum does not match. Start a new upload.') }
    if (source !== destination) await rename(source, destination)
    const id = runInTransaction(() => { const id = markRecordingDownloaded(filename, destination, { fileSize: value.size, dateRecorded: value.recorded_at }); markRecordingVerified(filename, value.checksum, value.serial); run('UPDATE recordings SET title=coalesce(title,?),title_source=coalesce(title_source,?) WHERE id=?', [value.filename, 'manual', id]); remeasureRecordingDuration(id); run("UPDATE server_uploads SET state='completed',recording_id=? WHERE id=?", [id, value.id]); return id })
    ready(id); return get(value.id)
  }))
  app.delete<{ Params: { id: string } }>('/api/v1/uploads/:id', async request => locked(request.params.id, async () => { const value = get(request.params.id); if (value.state === 'completed') throw new Error('Delete the recording from the library.'); await unlink(join(folder, value.id)).catch(error => { if (error.code !== 'ENOENT') throw error }); run('DELETE FROM server_uploads WHERE id=?', [value.id]); return { ok: true } }))
  app.get<{ Querystring: { serial: string } }>('/api/v1/device/manifest', async request => ({ recordings: queryAll('SELECT device_filename AS filename,size,checksum,recording_id AS recordingId FROM server_uploads WHERE serial=? AND state=\'completed\' AND recording_id IN (SELECT id FROM recordings WHERE verified=1)', [request.query.serial]), commands: queryAll("SELECT * FROM server_device_commands WHERE serial=? AND state='pending'", [request.query.serial]) }))
  app.post<{ Params: { id: string }; Body: { serial: string; checksum: string } }>('/api/v1/device/commands/:id/ack', async request => { const result = run("UPDATE server_device_commands SET state='completed' WHERE id=? AND serial=? AND checksum=?", [request.params.id, request.body.serial, request.body.checksum]); if (!result.changes) throw new Error('Device cleanup did not match.'); return { ok: true } })
  // Crash-interrupted capture prefixes remain explicitly marked until the owner finalizes them.
  run("UPDATE server_captures SET state='interrupted' WHERE state='recording'")
  app.get('/api/v1/captures', async () => queryAll("SELECT * FROM server_captures WHERE state<>'completed' ORDER BY created_at DESC"))
  app.post<{ Params: { id: string } }>('/api/v1/captures/:id/interrupt', async request => { run("UPDATE server_captures SET state='interrupted' WHERE id=? AND state='recording'", [request.params.id]); return { ok: true } })
  app.post<{ Params: { id: string } }>('/api/v1/captures/:id/resume', async request => { const item = queryOne<{ id: string; state: string; frames: number; bytes: number }>('SELECT * FROM server_captures WHERE id=?', [request.params.id]); if (!item) throw new Error('Capture not found.'); if (item.state !== 'completed') run("UPDATE server_captures SET state='recording' WHERE id=?", [item.id]); return item })
  app.post<{ Body: { serial: string } }>('/api/v1/captures', async request => { if (!/^[\w-]{1,100}$/.test(request.body?.serial)) throw new Error('Connect the recorder before capturing.'); const id = randomUUID(); const file = await open(join(folder, id + '.pcm'), 'wx', 0o600); await file.close(); run('INSERT INTO server_captures(id,serial,created_at) VALUES (?,?,?)', [id, request.body.serial, new Date().toISOString()]); return { id, frames: 0 } })
  app.put<{ Params: { id: string }; Querystring: { sequence: string }; Body: Buffer }>('/api/v1/captures/:id', { bodyLimit: CHUNK }, async request => locked(request.params.id, async () => {
    const item = queryOne<{ id: string; frames: number; bytes: number; state: string }>('SELECT * FROM server_captures WHERE id=?', [request.params.id]); if (!item || item.state !== 'recording' || !Buffer.isBuffer(request.body) || !request.body.length || request.body.length % 4 || item.bytes + request.body.length > 2 * 1024 ** 3 - 44) throw new Error('Invalid stereo PCM capture frame.')
    const sequence = Number(request.query.sequence); if (sequence < item.frames) return { frames: item.frames }; if (sequence !== item.frames) throw new Error('Capture sequence is out of order.')
    const file = await open(join(folder, item.id + '.pcm'), 'r+'); try { await file.truncate(item.bytes); let position = 0; while (position < request.body.length) { const part = await file.write(request.body, position, request.body.length - position, item.bytes + position); if (!part.bytesWritten) throw new Error('Capture storage is full.'); position += part.bytesWritten }; await file.sync() } finally { await file.close() }
    run('UPDATE server_captures SET frames=frames+1,bytes=bytes+? WHERE id=?', [request.body.length, item.id]); return { frames: item.frames + 1 }
  }))
  app.post<{ Params: { id: string } }>('/api/v1/captures/:id/finish', async request => locked(request.params.id, async () => {
    const item = queryOne<{ id: string; bytes: number; state: string; serial: string; recording_id: string }>('SELECT * FROM server_captures WHERE id=?', [request.params.id]); if (!item) throw new Error('Capture not found.'); if (item.state === 'completed') return { recordingId: item.recording_id }; if (!item.bytes) throw new Error('The capture contains no audio.')
    const filename = item.id + '.wav', destination = join(recordings, filename), pcm = await open(join(folder, item.id + '.pcm'), 'r'), file = await open(destination, 'w', 0o600)
    try { const header = Buffer.alloc(44); header.write('RIFF'); header.writeUInt32LE(36 + item.bytes, 4); header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22); header.writeUInt32LE(16000, 24); header.writeUInt32LE(64000, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(item.bytes, 40); await file.write(header); for await (const chunk of pcm.createReadStream({ autoClose: false, end: item.bytes - 1 })) await file.write(chunk as Buffer); await file.sync() } finally { await pcm.close(); await file.close() }
    const checksum = await hashFile(destination), id = runInTransaction(() => { const id = markRecordingDownloaded(filename, destination, { fileSize: item.bytes + 44 }); markRecordingVerified(filename, checksum, null); run('UPDATE recordings SET title=? WHERE id=?', [(item.state === 'interrupted' ? 'Interrupted capture ' : 'Live recording ') + new Date().toISOString(), id]); remeasureRecordingDuration(id); run("UPDATE server_captures SET state='completed',recording_id=? WHERE id=?", [id, item.id]); return id }); await unlink(join(folder, item.id + '.pcm')); ready(id); return { recordingId: id }
  }))
}
