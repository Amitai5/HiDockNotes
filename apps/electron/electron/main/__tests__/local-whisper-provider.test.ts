import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalWhisperProvider, whisperLanguage, whisperSegments } from '../ai/local-whisper-provider'
import type { OfflineRecognizerResult } from 'sherpa-onnx-node'
import { ProcessingError } from '../ai/errors'

const checkpoints = vi.hoisted(() => new Map<string, string>())
vi.mock('node:fs/promises', () => ({ mkdir: vi.fn(), readFile: vi.fn(async (path: string) => { if (!checkpoints.has(path)) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return checkpoints.get(path) }), writeFile: vi.fn(async (path: string, content: string) => { checkpoints.set(path, content) }), rename: vi.fn(async (from: string, to: string) => { checkpoints.set(to, checkpoints.get(from)!); checkpoints.delete(from) }), rm: vi.fn(async (path: string) => { checkpoints.delete(path) }) }))

describe('offline local Whisper transcription', () => {
  const ensure = vi.fn(), readWave = vi.fn(), decodeAsync = vi.fn(), acceptWaveform = vi.fn(), createAsync = vi.fn(), load = vi.fn()
  const speech: OfflineRecognizerResult = { text: 'Send the plan.', segment_texts: [' Send the plan.'], segment_timestamps: [1], segment_durations: [2] }
  beforeEach(() => {
    vi.clearAllMocks()
    checkpoints.clear()
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
    expect(() => whisperSegments({ ...speech, segment_timestamps: [NaN] }, 10)).toThrow('corrupted timing')
    expect(() => whisperSegments({ ...speech, segment_durations: [-1] }, 10)).toThrow('corrupted timing')
    expect(whisperSegments({ text: '' }, 10)).toEqual([])
  })
  it('recovers the native zero-duration final-segment sentinel using the real audio end', () => {
    expect(whisperSegments({ ...speech, segment_timestamps: [2], segment_durations: [0] }, 10)).toEqual([{ start: 2, end: 10, text: 'Send the plan.' }])
  })
  it('uses the next native boundary for a zero-duration segment before later speech', () => {
    expect(whisperSegments({ text: 'First. Second.', segment_texts: ['First.', 'Second.'], segment_timestamps: [1, 4], segment_durations: [0, 2] }, 10)).toEqual([{ start: 1, end: 4, text: 'First.' }, { start: 4, end: 6, text: 'Second.' }])
  })
  it('clips a segment to real audio and omits text entirely inside decoder padding', () => {
    expect(whisperSegments({ text: 'Real. Padding.', segment_texts: ['Real.', 'Padding.'], segment_timestamps: [1, 12], segment_durations: [15, 2] }, 10)).toEqual([{ start: 1, end: 10, text: 'Real.' }])
  })
  it('handles the real short-tail failure pattern without retaining padded hallucinations', () => {
    const result = { text: 'Real speech. Padded speech.', segment_texts: ['Real speech.', 'Padding 1', 'Padding 2', 'Padding 3', 'Padding 4', 'Padding 5'], segment_timestamps: [0, 8, 10, 12, 14, 16], segment_durations: [8, 2, 2, 2, 2, 0] }
    expect(whisperSegments(result, 8)).toEqual([{ start: 0, end: 8, text: 'Real speech.' }])
  })
  it('ignores empty decoder artifacts without rejecting the actual speech', () => {
    expect(whisperSegments({ text: 'Speech.', segment_texts: [' ', 'Speech.'], segment_timestamps: [NaN, 1], segment_durations: [NaN, 2] }, 10)).toEqual([{ start: 1, end: 3, text: 'Speech.' }])
  })
  it('never accepts invalid timing or uses a nonexistent audio duration', () => {
    expect(() => whisperSegments({ ...speech, segment_timestamps: [-1] }, 10)).toThrow('corrupted timing')
    expect(() => whisperSegments(speech, NaN)).toThrow('audio duration')
  })
  it('skips preflight-confirmed silent sections while retaining original speech positions', async () => {
    readWave.mockReturnValue({ sampleRate: 16000, samples: new Float32Array(960000) })
    const progress = vi.fn()
    const result = await provider().transcribe('whisper-base', { path: '/audio.wav', duration: 60, language: 'en', activityIntervals: [{ start: 55, end: 60 }], progress })
    expect(decodeAsync).toHaveBeenCalledOnce()
    expect(result.segments[0].start).toBe(50)
    expect(progress.mock.calls.some(([message]) => message.includes('Skipped silent section'))).toBe(true)
  })
  it('does not load the recognizer when all sections are confirmed silent', async () => {
    expect(await provider().transcribe('whisper-base', { path: '/quiet.wav', duration: 10, language: 'auto', activityIntervals: [] })).toEqual({ text: '', words: [], segments: [] })
    expect(createAsync).not.toHaveBeenCalled()
    expect(ensure).not.toHaveBeenCalled()
  })
  it('resumes saved local sections after failure and restart instead of decoding them again', async () => {
    readWave.mockReturnValue({ sampleRate: 16000, samples: new Float32Array(960000) })
    decodeAsync.mockResolvedValueOnce(speech).mockRejectedValueOnce(new ProcessingError('Temporary interruption.'))
    const chunk = { path: '/audio.wav', duration: 60, language: 'en', checkpointDirectory: '/cache/sections', progress: vi.fn() }
    await expect(provider().transcribe('whisper-base', chunk)).rejects.toThrow('interruption')
    expect([...checkpoints.values()]).toHaveLength(1)
    const result = await provider().transcribe('whisper-base', chunk)
    expect(decodeAsync).toHaveBeenCalledTimes(4)
    expect(result.segments.map(segment => segment.start)).toEqual([1, 25, 50])
    expect(chunk.progress).toHaveBeenCalledWith('Resumed saved section 1 of 3.', expect.any(Number))
  })
  it('binds local checkpoints to the actual audio bytes and model selection', async () => {
    const samples = new Float32Array(160000)
    readWave.mockReturnValue({ sampleRate: 16000, samples })
    const chunk = { path: '/audio.wav', duration: 10, language: 'en', checkpointDirectory: '/cache/sections' }
    await provider().transcribe('whisper-base', chunk)
    await provider().transcribe('whisper-base', chunk)
    expect(decodeAsync).toHaveBeenCalledOnce()
    samples[0] = 0.5
    await provider().transcribe('whisper-base', chunk)
    await provider().transcribe('whisper-small', chunk)
    expect(decodeAsync).toHaveBeenCalledTimes(3)
  })
})
