import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, initializeDatabase, queryOne, run, upsertRecordingFromDevice } from '../services/database'
import { RecordingDeletionService } from '../services/recording-deletion'
import type { PipelineState } from '../types/device-pipeline'

const files = vi.hoisted(() => ({ unlink: vi.fn(), rm: vi.fn(), lstat: vi.fn(), readdir: vi.fn() }))
vi.mock('node:fs/promises', () => files)
describe('confirmed complete recording deletion', () => {
  let id: string, state: PipelineState, remove: ReturnType<typeof vi.fn>, service: RecordingDeletionService
  beforeEach(() => {
    initializeDatabase(':memory:'); vi.clearAllMocks()
    id = upsertRecordingFromDevice({ filename: 'meeting.hda', size: 200, duration: 10, dateCreated: new Date('2026-10-07T10:00:00Z') }).id
    run("UPDATE recordings SET file_path='/owned/meeting.wav',verified=1,checksum='checked',device_serial='original' WHERE id=?", [id])
    run("INSERT INTO transcripts(id,recording_id,text) VALUES ('t',?,'private transcript')", [id])
    run("INSERT INTO speakers(id,recording_id,label) VALUES ('s',?,'Dana')", [id])
    run("INSERT INTO segments(id,recording_id,start,end,text,speaker_id) VALUES ('seg',?,0,1,'private transcript','s')", [id])
    run("INSERT INTO summaries(id,recording_id,text) VALUES ('summary',?,'summary')", [id])
    run("INSERT INTO actionables(id,recording_id,text) VALUES ('action',?,'task')", [id])
    run("INSERT INTO voice_profiles(id,name,created_at) VALUES ('person','Dana','2026-10-07')")
    run("INSERT INTO voice_samples(id,voice_profile_id,embedding,source_recording,created_at) VALUES ('sample','person',?,?,'2026-10-07')", [Buffer.from([1]), id])
    run("INSERT INTO voice_samples(id,voice_profile_id,embedding,created_at) VALUES ('other','person',?,'2026-10-07')", [Buffer.from([2])])
    state = { phase: 'idle', device: { serialNumber: 'original', model: 'hidock-p1', firmwareVersion: '1', storage: null, settings: null, recordingCount: 1 }, scanProgress: null, downloadProgress: null, error: null } as PipelineState
    remove = vi.fn(async () => ({ result: 'success' }))
    files.lstat.mockResolvedValue({ isFile: () => true, isSymbolicLink: () => false }); files.unlink.mockResolvedValue(undefined); files.rm.mockResolvedValue(undefined); files.readdir.mockResolvedValue([id + '-200.wav', 'other.wav'])
    service = new RecordingDeletionService({ dataPath: '/app', device: { getState: () => state, deleteFile: remove }, pause: async (_id, operation) => operation(), waitPlayback: vi.fn(async () => undefined), dismissDownload: vi.fn(), changed: vi.fn() })
  })
  afterEach(closeDatabase)
  it('requires confirmation and the original idle device before touching audio or metadata', async () => {
    await expect(service.delete(id, false)).rejects.toThrow('Confirm')
    state.phase = 'disconnected'; await expect(service.delete(id, true)).rejects.toThrow('original recorder')
    state.phase = 'idle'; state.device!.serialNumber = 'other'; await expect(service.delete(id, true)).rejects.toThrow('original recorder')
    state.device!.serialNumber = 'original'; state.phase = 'downloading'; await expect(service.delete(id, true)).rejects.toThrow('current operation')
    expect(remove).not.toHaveBeenCalled(); expect(files.unlink).not.toHaveBeenCalled(); expect(queryOne('SELECT id FROM recordings WHERE id=?', [id])).toBeTruthy()
  })
  it('keeps all local data when device verification or acknowledgement fails', async () => {
    remove.mockRejectedValueOnce(new Error('Local verification failed'))
    await expect(service.delete(id, true)).rejects.toThrow('verification')
    remove.mockResolvedValueOnce({ result: 'failed' }); await expect(service.delete(id, true)).rejects.toThrow('did not confirm')
    expect(files.unlink).not.toHaveBeenCalled(); expect(queryOne('SELECT id FROM segments')).toBeTruthy(); expect(queryOne('SELECT recording_id FROM recording_deletions')).toBeUndefined()
  })
  it('deletes source audio only after acknowledgement, removes dependent data and preserves other voice samples', async () => {
    remove.mockImplementationOnce(async () => { expect(files.unlink).not.toHaveBeenCalled(); expect(queryOne('SELECT id FROM recordings WHERE id=?', [id])).toBeTruthy(); return { result: 'success' } })
    await service.delete(id, true)
    expect(files.unlink).toHaveBeenCalledWith('/owned/meeting.wav')
    expect(files.rm).toHaveBeenCalledTimes(2)
    for (const table of ['recordings', 'transcripts', 'segments', 'speakers', 'summaries', 'actionables', 'recording_fts', 'recording_deletions']) expect(queryOne(`SELECT * FROM ${table}`)).toBeUndefined()
    expect(queryOne('SELECT id FROM voice_samples WHERE id=\'sample\'')).toBeUndefined()
    expect(queryOne('SELECT id FROM voice_samples WHERE id=\'other\'')).toBeTruthy()
    expect(queryOne('SELECT filename FROM purge_tombstones')).toBeTruthy()
    expect(files.unlink).not.toHaveBeenCalledWith('/app/cache/playback/other.wav')
  })
  it('persists acknowledged deletion so local cleanup retries do not send a second USB command', async () => {
    files.unlink.mockRejectedValueOnce(new Error('File is busy'))
    await expect(service.delete(id, true)).rejects.toThrow('busy')
    expect(queryOne<{ device_done: number }>('SELECT device_done FROM recording_deletions')?.device_done).toBe(1)
    state.phase = 'disconnected'
    await service.delete(id, true)
    expect(remove).toHaveBeenCalledOnce(); expect(queryOne('SELECT id FROM recordings')).toBeUndefined()
  })
  it('deletes an imported recording locally without connecting or calling a recorder', async () => {
    run('UPDATE recordings SET device_serial=NULL WHERE id=?', [id]); state.phase = 'disconnected'
    await service.delete(id, true)
    expect(remove).not.toHaveBeenCalled(); expect(queryOne('SELECT id FROM recordings')).toBeUndefined()
  })
  it('does not delete shared audio or follow a symlink cache outside app storage', async () => {
    const other = upsertRecordingFromDevice({ filename: 'other.hda', size: 200, duration: 10, dateCreated: new Date('2026-10-07T10:00:00Z') })
    run("UPDATE recordings SET file_path='/owned/meeting.wav' WHERE id=?", [other.id])
    await expect(service.delete(id, true)).rejects.toThrow('shares')
    expect(remove).not.toHaveBeenCalled(); expect(files.unlink).not.toHaveBeenCalled()
    run('UPDATE recordings SET file_path=NULL WHERE id=?', [other.id])
    files.lstat.mockResolvedValueOnce({ isFile: () => true, isSymbolicLink: () => false }).mockResolvedValueOnce({ isSymbolicLink: () => true })
    await expect(service.delete(id, true)).rejects.toThrow('outside app storage')
    expect(files.rm).not.toHaveBeenCalled()
  })
  it('keeps shutdown waiting until a confirmed delete and its local cleanup finish', async () => {
    let release: (() => void) | undefined, drained = false
    remove.mockImplementationOnce(() => new Promise<{ result: string }>(resolve => { release = () => resolve({ result: 'success' }) }))
    const deletion = service.delete(id, true)
    const shutdown = service.drain().then(() => { drained = true })
    await Promise.resolve()
    expect(drained).toBe(false)
    release!(); await deletion; await shutdown
    expect(drained).toBe(true)
    expect(queryOne('SELECT id FROM recordings')).toBeUndefined()
  })
})
