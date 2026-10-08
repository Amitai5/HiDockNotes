import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalWhisperProvider, whisperLanguage, whisperSegments } from '../ai/local-whisper-provider'
import type { OfflineRecognizerResult } from 'sherpa-onnx-node'

describe('offline local Whisper transcription', () => {
  const ensure = vi.fn(), readWave = vi.fn(), decodeAsync = vi.fn(), acceptWaveform = vi.fn(), createAsync = vi.fn(), load = vi.fn()
  const speech: OfflineRecognizerResult = { text: 'Send the plan.', segment_texts: [' Send the plan.'], segment_timestamps: [1], segment_durations: [2] }
  beforeEach(() => {
    vi.clearAllMocks()
    ensure.mockResolvedValue({ encoder: '/local/encoder.onnx', decoder: '/local/decoder.onnx', tokens: '/local/tokens.txt' })
    readWave.mockReturnValue({ sampleRate: 16000, samples: new Float32Array(160000) })
    decodeAsync.mockResolvedValue(speech)
    createAsync.mockResolvedValue({ createStream: () => ({ acceptWaveform }), decodeAsync })
    load.mockResolvedValue({ OfflineRecognizer: { createAsync }, readWave })
  })
  function provider(): LocalWhisperProvider { return new LocalWhisperProvider({ cache: { ensure }, load, threads: 2 }) }
  it('uses verified local models, CPU inference and native integer timestamp flags without a key', async () => {
    const result = await provider().transcribe('whisper-small', { path: '/audio.wav', duration: 10, language: 'en-US' })
    expect(ensure).toHaveBeenCalledWith('whisper-small', expect.any(Function), undefined)
    expect(createAsync.mock.calls[0][0]).toMatchObject({ modelConfig: { whisper: { enableSegmentTimestamps: 1, enableTokenTimestamps: 0, task: 'transcribe', language: 'en' }, provider: 'cpu', numThreads: 2, debug: false } })
    expect(result).toEqual({ text: 'Send the plan.', words: [], segments: [{ start: 1, end: 3, text: 'Send the plan.' }] })
  })
  it('reuses a loaded recognizer for subsequent chunks with the same model and language', async () => {
    const engine = provider(), chunk = { path: '/audio.wav', duration: 10, language: 'auto' }
    await engine.transcribe('whisper-small', chunk); await engine.transcribe('whisper-small', chunk)
    expect(ensure).toHaveBeenCalledTimes(1); expect(createAsync).toHaveBeenCalledTimes(1)
    expect(createAsync.mock.calls[0][0].modelConfig.whisper.language).toBe('')
  })
  it('downloads and verifies models before speaker detection without loading recognition twice', async () => {
    const engine = provider(), progress = vi.fn()
    await engine.prepare('whisper-small', progress)
    expect(load).not.toHaveBeenCalled()
    await engine.transcribe('whisper-small', { path: '/audio.wav', duration: 10, language: 'en' })
    expect(ensure).toHaveBeenCalledTimes(1)
    expect(createAsync).toHaveBeenCalledOnce()
  })
  it('loads the newly selected model instead of retaining a previous model', async () => {
    const engine = provider(), chunk = { path: '/audio.wav', duration: 10, language: 'en' }
    await engine.transcribe('whisper-small', chunk); await engine.transcribe('whisper-base', chunk)
    expect(ensure.mock.calls.map(call => call[0])).toEqual(['whisper-small', 'whisper-base'])
    expect(createAsync).toHaveBeenCalledTimes(2)
  })
  it('decodes bounded windows and retains their real positions in long audio', async () => {
    readWave.mockReturnValue({ sampleRate: 16000, samples: new Float32Array(960000) })
    const result = await provider().transcribe('whisper-base', { path: '/long.wav', duration: 60, language: 'auto' })
    expect(result.segments.map(segment => segment.start)).toEqual([1, 25, 50])
    expect(acceptWaveform.mock.calls.every(([wave]) => wave.samples.length <= 27 * 16000)).toBe(true)
  })
  it('advances real section progress within an audio part instead of staying at zero', async () => {
    readWave.mockReturnValue({ sampleRate: 16000, samples: new Float32Array(960000) })
    const progress = vi.fn()
    await provider().transcribe('whisper-small', { path: '/long.wav', duration: 60, language: 'en', progress })
    expect(progress.mock.calls.some(([, fraction]) => fraction > 0 && fraction < 1)).toBe(true)
    expect(progress).toHaveBeenLastCalledWith('Transcribed 3 of 3 local sections.', 1)
  })
  it('rejects cancellation before model downloads and discards results cancelled during decoding', async () => {
    const aborted = new AbortController(); aborted.abort()
    await expect(provider().transcribe('whisper-small', { path: '/audio', duration: 10, language: 'en' }, aborted.signal)).rejects.toThrow()
    expect(ensure).not.toHaveBeenCalled()
    const pending = new AbortController()
    decodeAsync.mockImplementation(async () => { pending.abort(); return speech })
    await expect(provider().transcribe('whisper-small', { path: '/audio', duration: 10, language: 'en' }, pending.signal)).rejects.toThrow()
  })
  it('rejects incompatible audio instead of silently decoding the wrong sample rate', async () => {
    readWave.mockReturnValue({ sampleRate: 8000, samples: new Float32Array(8000) })
    await expect(provider().transcribe('whisper-small', { path: '/audio', duration: 1, language: 'en' })).rejects.toThrow('16 kHz')
    expect(decodeAsync).not.toHaveBeenCalled()
  })
  it('cannot be used as a summary or chat model', async () => {
    await expect(provider().chat()).rejects.toThrow('chat provider')
    expect(load).not.toHaveBeenCalled()
  })
  it.each(['en-US', 'he', 'fr-CA', 'auto'])('maps the requested language %s to Whisper input', language => {
    expect(whisperLanguage(language)).toBe(language === 'auto' ? '' : language.toLowerCase().split('-')[0])
  })
  it('does not invent word or segment timestamps when the native result omits them', () => {
    expect(() => whisperSegments({ text: 'Unaligned speech' }, 10)).toThrow('without usable timestamps')
    expect(() => whisperSegments({ ...speech, segment_timestamps: [NaN] }, 10)).toThrow('invalid')
    expect(() => whisperSegments({ ...speech, segment_durations: [-1] }, 10)).toThrow('invalid')
    expect(whisperSegments({ text: '' }, 10)).toEqual([])
  })
})
