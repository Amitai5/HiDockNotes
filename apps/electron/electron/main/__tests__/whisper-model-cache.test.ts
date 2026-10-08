import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WHISPER_ASSETS, WhisperModelCache, validateWhisperArchive, whisperModelId } from '../ai/whisper-model-cache'

const mocks = vi.hoisted(() => ({ hash: vi.fn(), rm: vi.fn(), mkdir: vi.fn(), rename: vi.fn() }))
vi.mock('../ai/model-cache', () => ({ sha256File: mocks.hash }))
vi.mock('node:fs/promises', () => ({ ...mocks, readFile: vi.fn() }))
vi.mock('node:fs', async () => { const { Writable } = await import('node:stream'); return { createReadStream: vi.fn(), createWriteStream: () => new Writable({ write(_chunk, _encoding, callback) { callback() } }) } })

describe('verified first-use local Whisper models', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.hash.mockRejectedValue(new Error('Uncached')) })
  it('reuses all three checksum-verified cached files without a network request', async () => {
    mocks.hash.mockImplementation(async (path: string) => path.endsWith('encoder.int8.onnx') ? WHISPER_ASSETS['whisper-small'].encoder : path.endsWith('decoder.int8.onnx') ? WHISPER_ASSETS['whisper-small'].decoder : 'b34b360dbb493e781e479794586d661700670d65564001f23024971d1f2fa126')
    const request = vi.fn()
    expect(await new WhisperModelCache('/models', request).ensure('whisper-small', vi.fn())).toMatchObject({ encoder: expect.stringContaining('encoder.int8.onnx') })
    expect(request).not.toHaveBeenCalled()
  })
  it('shows a recoverable download error and removes its partial staging files', async () => {
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 503 }))
    await expect(new WhisperModelCache('/models', request).ensure('whisper-small', vi.fn())).rejects.toThrow('official release')
    expect(request.mock.calls[0][0]).toBe('https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-small.tar.bz2')
    expect(mocks.rm).toHaveBeenCalledWith(expect.stringContaining('download-'), { recursive: true, force: true })
    expect(mocks.rename).not.toHaveBeenCalled()
  })
  it('refuses truncated model downloads before extraction or cache publication', async () => {
    const request = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3])))
    await expect(new WhisperModelCache('/models', request).ensure('whisper-base', vi.fn())).rejects.toThrow('failed verification')
    expect(mocks.rename).not.toHaveBeenCalled()
  })
  it('rejects cancellation before checking or downloading model files', async () => {
    const controller = new AbortController(); controller.abort()
    const request = vi.fn()
    await expect(new WhisperModelCache('/models', request).ensure('whisper-small', vi.fn(), controller.signal)).rejects.toThrow()
    expect(request).not.toHaveBeenCalled(); expect(mocks.hash).not.toHaveBeenCalled()
  })
  it.each([['../outside'], ['root/../outside'], ['/absolute'], ['root\\escape'], []])('rejects unsafe archive members %j', (...entries) => {
    expect(() => validateWhisperArchive(entries as string[], 'root')).toThrow('unexpected path')
  })
  it('pins complete hashes and permits only the intended local model names', () => {
    for (const asset of Object.values(WHISPER_ASSETS)) for (const hash of [asset.sha256, asset.encoder, asset.decoder]) expect(hash).toMatch(/^[a-f0-9]{64}$/)
    expect(whisperModelId('whisper-small')).toBe('whisper-small')
    expect(() => whisperModelId('../../custom')).toThrow('supported')
    expect(() => validateWhisperArchive(['root/', 'root/model.onnx'], 'root')).not.toThrow()
  })
})
