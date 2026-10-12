import { beforeEach, describe, expect, it, vi } from 'vitest'
import { copyFile, mkdtemp, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { queryOne } from '../database'
import { hashFile } from '../file-verification'
import { preparePlayback } from '../audio-playback'
import { exportFilename, exportNotesFile, exportNotesWithAudio, validateExportOptions } from '../recording-export'
import type { RecordingDetail } from '../../../../src/shared/contracts'
import { DEFAULT_EXPORT_OPTIONS } from '../../../../src/shared/export'

vi.mock('node:fs/promises', () => ({ copyFile: vi.fn(), mkdtemp: vi.fn(), rename: vi.fn(), rm: vi.fn(), stat: vi.fn(), unlink: vi.fn(), writeFile: vi.fn() }))
vi.mock('../database', () => ({ queryOne: vi.fn() }))
vi.mock('../file-verification', () => ({ hashFile: vi.fn() }))
vi.mock('../audio-playback', () => ({ preparePlayback: vi.fn() }))
const detail: RecordingDetail = { recording: { id: 'recording', filename: 'source.hda', title: 'Planning', recordedAt: '2026-10-08T10:00:00Z', duration: 5, size: 100, status: 'done', verified: true, hasAudio: true, projectId: null, summary: '## Decisions\nKeep the plan.' }, segments: [{ id: 'segment', start: 1, end: 2, text: 'This is the full transcript.', speakerId: null, speakerName: 'Dana' }], actionables: [] }
describe('recording export safety and options', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(queryOne).mockReturnValue({ id: 'recording', file_path: '/original/source.hda', file_size: 100, verified: 1, checksum: 'hash' })
    vi.mocked(hashFile).mockResolvedValue('hash')
    vi.mocked(stat).mockResolvedValue({ isFile: () => true, size: 100, mtimeMs: 1000 } as Awaited<ReturnType<typeof stat>>)
    vi.mocked(preparePlayback).mockResolvedValue('/cache/audio.wav')
    vi.mocked(mkdtemp).mockResolvedValue('/exports/Planning-unique')
    vi.mocked(unlink).mockResolvedValue()
  })
  it.each([null, [], {}, { ...DEFAULT_EXPORT_OPTIONS, includeAudio: 'yes' }, { ...DEFAULT_EXPORT_OPTIONS, content: ['summary'] }, { ...DEFAULT_EXPORT_OPTIONS, format: 'exe' }, { ...DEFAULT_EXPORT_OPTIONS, path: '/original' }, { ...DEFAULT_EXPORT_OPTIONS, content: 'summary', format: 'srt' }])('rejects unsafe or inconsistent export options: %j', input => { expect(() => validateExportOptions(input)).toThrow() })
  it('keeps the old bridge call compatible and accepts the new choices', () => {
    expect(validateExportOptions(undefined)).toEqual(DEFAULT_EXPORT_OPTIONS)
    expect(validateExportOptions({ content: 'summary', format: 'txt', includeAudio: true })).toEqual({ content: 'summary', format: 'txt', includeAudio: true })
  })
  it('saves summary-only notes through an atomic staged file and does not touch audio', async () => {
    await exportNotesFile(detail, '/exports/notes.md', { ...DEFAULT_EXPORT_OPTIONS, content: 'summary' })
    expect(writeFile).toHaveBeenCalledWith(expect.stringMatching(/notes\.md\..+\.partial$/), expect.not.stringContaining('This is the full transcript.'), expect.objectContaining({ flag: 'wx' }))
    expect(rename).toHaveBeenCalledWith(expect.any(String), '/exports/notes.md')
    expect(copyFile).not.toHaveBeenCalled()
    expect(preparePlayback).not.toHaveBeenCalled()
  })
  it('uses a newly owned export folder and verifies the playable audio copy', async () => {
    await exportNotesWithAudio(detail, '/exports', { ...DEFAULT_EXPORT_OPTIONS, includeAudio: true })
    expect(mkdtemp).toHaveBeenCalledWith(join('/exports', 'Planning-'))
    expect(copyFile).toHaveBeenCalledWith('/cache/audio.wav', join('/exports/Planning-unique', 'Planning.wav'), expect.any(Number))
    expect(hashFile).toHaveBeenCalledWith('/original/source.hda')
    expect(hashFile).toHaveBeenCalledWith(join('/exports/Planning-unique', 'Planning.wav'))
    expect(writeFile).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('This is the full transcript.'), expect.any(Object))
    expect(rm).not.toHaveBeenCalled()
  })
  it('refuses changed source audio before creating an export folder', async () => {
    vi.mocked(hashFile).mockResolvedValue('wrong')
    await expect(exportNotesWithAudio(detail, '/exports', { ...DEFAULT_EXPORT_OPTIONS, includeAudio: true })).rejects.toThrow('changed after verification')
    expect(mkdtemp).not.toHaveBeenCalled()
    expect(copyFile).not.toHaveBeenCalled()
  })
  it('cleans only its own export folder if a large audio copy fails', async () => {
    vi.mocked(copyFile).mockRejectedValue(new Error('Disk full'))
    await expect(exportNotesWithAudio(detail, '/exports', { ...DEFAULT_EXPORT_OPTIONS, includeAudio: true })).rejects.toThrow('Disk full')
    expect(rm).toHaveBeenCalledExactlyOnceWith('/exports/Planning-unique', { recursive: true, force: true })
    expect(writeFile).not.toHaveBeenCalled()
  })
  it('makes a safe filename from a user title on Windows and macOS', () => {
    expect(exportFilename('../Planning: Q4?')).not.toContain('/')
    expect(exportFilename('CON')).toBe('_CON')
    expect(exportFilename('...')).toBe('Recording')
    expect(exportFilename('A'.repeat(300))).toHaveLength(100)
  })
})
