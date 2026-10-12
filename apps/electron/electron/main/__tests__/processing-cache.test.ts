import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isTranscriptionResult, readProcessingCache, writeProcessingCache } from '../ai/processing-cache'

const files = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), rename: vi.fn(), rm: vi.fn(), mkdir: vi.fn() }))
vi.mock('node:fs/promises', () => ({ readFile: files.read, writeFile: files.write, rename: files.rename, rm: files.rm, mkdir: files.mkdir }))

describe('local processing checkpoints', () => {
  beforeEach(() => { vi.resetAllMocks(); files.write.mockResolvedValue(undefined); files.rename.mockResolvedValue(undefined); files.rm.mockResolvedValue(undefined) })
  it('treats absent or malformed checkpoints as work to redo', async () => {
    files.read.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' })).mockResolvedValueOnce('{broken')
    expect(await readProcessingCache('/missing')).toBeNull()
    expect(await readProcessingCache('/broken')).toBeNull()
  })
  it('reports inaccessible cache storage rather than silently discarding its work', async () => {
    files.read.mockRejectedValue(Object.assign(new Error('private path'), { code: 'EACCES' }))
    await expect(readProcessingCache('/denied')).rejects.toThrow('folder permissions')
  })
  it('writes private staged bytes before atomically replacing the checkpoint', async () => {
    await writeProcessingCache('/cache/section.json', { complete: true })
    const staged = files.write.mock.calls[0][0]
    expect(staged).toMatch(/^\/cache\/section\.json\.[a-f0-9-]+\.partial$/)
    expect(files.write).toHaveBeenCalledWith(staged, '{"complete":true}', { mode: 0o600 })
    expect(files.rename).toHaveBeenCalledWith(staged, '/cache/section.json')
    expect(files.rm).toHaveBeenCalledWith(staged, { force: true })
  })
  it('cleans up only the staged file if publication fails', async () => {
    files.rename.mockRejectedValue(new Error('disk full'))
    await expect(writeProcessingCache('/cache/section.json', [])).rejects.toThrow('disk full')
    expect(files.rm.mock.calls[0][0]).not.toBe('/cache/section.json')
  })
  it('refuses corrupted or out-of-bounds cached speech', () => {
    const result = { text: 'Send it.', words: [], segments: [{ start: 1, end: 2, text: 'Send it.' }] }
    expect(isTranscriptionResult(result, 10)).toBe(true)
    expect(isTranscriptionResult({ ...result, segments: [{ start: NaN, end: 2, text: 'Send it.' }] }, 10)).toBe(false)
    expect(isTranscriptionResult({ ...result, segments: [{ start: 8, end: 12, text: 'Send it.' }] }, 10)).toBe(false)
  })
})
