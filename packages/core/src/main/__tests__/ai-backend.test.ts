import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_AI_SETTINGS } from '../../../src/shared/ai'
import { LocalTranscriptionBackend, type BackendObserver, type ProcessingInput } from '../ai/backend'
import { ProcessingError } from '../ai/errors'
import type { ModelCache } from '../ai/model-cache'
import type { ProviderClient } from '../ai/providers'
import { EMPTY_REFERENCE_CONTEXT } from '../../../src/shared/reference-context'

const mocks = vi.hoisted(() => ({ files: new Map<string, string>(), checksum: vi.fn(), convert: vi.fn(), preflight: vi.fn(), extract: vi.fn(), speech: vi.fn() }))
vi.mock('node:fs/promises', () => ({ mkdir: vi.fn(), rm: vi.fn(async (path: string) => { mocks.files.delete(path) }), readFile: vi.fn(async (path: string) => { if (!mocks.files.has(path)) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return mocks.files.get(path) }), writeFile: vi.fn(async (path: string, data: string) => { mocks.files.set(path, data) }), rename: vi.fn(async (from: string, to: string) => { mocks.files.set(to, mocks.files.get(from)!); mocks.files.delete(from) }) }))
vi.mock('node:child_process', () => ({ execFile: (...args: unknown[]) => { mocks.extract(args); const callback = args[args.length - 1] as (error: unknown, output: string) => void; callback(null, '') } }))
vi.mock('../services/audio-playback', () => ({ convertAudioFile: mocks.convert }))
vi.mock('../services/audio-preflight', () => ({ analyzeAudioPreflight: mocks.preflight }))
vi.mock('../ai/local-speech', async () => ({ ...(await vi.importActual('../ai/local-speech')), detectSpeech: mocks.speech }))
vi.mock('../ai/model-cache', () => ({ sha256File: mocks.checksum, ModelCache: class {} }))

describe('local transcription backend', () => {
  const input: ProcessingInput = { id: 'recording', path: '/verified/audio.hda', checksum: 'checked', dataPath: '/local', settings: { ...structuredClone(DEFAULT_AI_SETTINGS), transcription: { provider: 'gemini', model: 'gemini-3.5-transcribe' } }, keys: { gemini: 'AQ.fake-key', openai: null }, profiles: [] }
  let client: ProviderClient
  let diarize: ReturnType<typeof vi.fn>
  let models: ReturnType<typeof vi.fn>
  let observer: BackendObserver
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.speech.mockImplementation(async () => (await mocks.preflight.mock.results.at(-1)!.value).activityIntervals ?? [{ start: 0, end: 20 }]); mocks.files.clear(); mocks.checksum.mockResolvedValue('checked'); mocks.convert.mockResolvedValue('/converted.wav')
    mocks.preflight.mockResolvedValue({ status: 'speech_present', durationSeconds: 20, activityIntervals: [{ start: 0, end: 20 }] })
    diarize = vi.fn().mockResolvedValue({ duration: 20, turns: [{ start: 0, end: 20, speaker: 0 }], embeddings: [{ speaker: 0, vector: [1, 0] }] })
    models = vi.fn(() => ({ ensureSpeech: vi.fn().mockResolvedValue('/speech.onnx'), ensure: vi.fn().mockResolvedValue({ segmentation: '/seg.onnx', embedding: '/embed.onnx' }) }) as unknown as ModelCache)
    client = { listModels: vi.fn(), chat: vi.fn(), transcribe: vi.fn().mockResolvedValue({ text: 'Send it.', words: [{ start: 2, end: 3, text: 'Send' }, { start: 3, end: 4, text: 'it.' }], segments: [] }), summarize: vi.fn().mockResolvedValue({ title: 'Plan', summary: 'Send the plan.', actionItems: [{ text: 'Send the plan', start: 2 }] }) }
    observer = { stage: vi.fn(), checkpoint: vi.fn() }
  })
  it.each([false, true])('passes reference context through %s saved-transcript mode without sending it to audio transcription', async saved => {
    const referenceContext = { global: { ...EMPTY_REFERENCE_CONTEXT, terminology: 'Shared acronym' }, projects: [] }
    const savedTranscript = saved ? { duration: 20, speakers: [], segments: [{ id: 'saved', start: 2, end: 4, text: 'My corrected text', speakerId: null, speakerName: null }] } : undefined
    await new LocalTranscriptionBackend(() => client, diarize, models).process({ ...input, referenceContext, savedTranscript }, observer)
    expect(vi.mocked(client.summarize).mock.calls[0][4]).toMatchObject({ referenceContext })
    if (saved) expect(client.transcribe).not.toHaveBeenCalled()
    else expect(vi.mocked(client.transcribe).mock.calls[0][1]).not.toHaveProperty('referenceContext')
  })
  it('converts, diarizes, transcribes, aligns, identifies and summarizes with independent providers', async () => {
    const providers = vi.fn(() => client)
    const backend = new LocalTranscriptionBackend(providers, diarize, models)
    const result = await backend.process({ ...input, settings: { ...input.settings, chat: { provider: 'openai', model: 'gpt-5.4-mini' } }, keys: { ...input.keys, openai: 'sk-fake' }, profiles: [{ id: 'dana', name: 'Dana', embeddings: [[1, 0]] }] }, observer)
    expect(providers.mock.calls.map(call => call[0])).toEqual(['gemini', 'openai'])
    expect(result.segments[0]).toMatchObject({ text: 'Send it.', speakerName: 'Dana', start: 2, end: 4 })
    expect(result.summary?.actionItems).toHaveLength(1)
    expect(observer.checkpoint).toHaveBeenCalledOnce()
  })
  it('blocks cloud uploads when the local copy no longer matches its verification checksum', async () => {
    mocks.checksum.mockResolvedValue('changed')
    const backend = new LocalTranscriptionBackend(() => client, diarize, models)
    await expect(backend.process(input, observer)).rejects.toThrow('changed after verification')
    expect(client.transcribe).not.toHaveBeenCalled()
  })
  it('skips silence before downloading models or contacting providers', async () => {
    mocks.preflight.mockResolvedValue({ status: 'no_speech', durationSeconds: 20 })
    const backend = new LocalTranscriptionBackend(() => client, diarize, models)
    expect((await backend.process(input, observer)).empty).toBe(true)
    expect(models).not.toHaveBeenCalled()
    expect(client.transcribe).not.toHaveBeenCalled()
  })
  it('reuses completed transcription after a failed summary instead of uploading audio twice', async () => {
    const backend = new LocalTranscriptionBackend(() => client, diarize, models)
    vi.mocked(client.summarize).mockRejectedValueOnce(new ProcessingError('Summary quota exhausted.'))
    await expect(backend.process(input, observer)).rejects.toThrow('Summary quota')
    await backend.process(input, observer)
    expect(client.transcribe).toHaveBeenCalledTimes(1)
    expect(diarize).toHaveBeenCalledTimes(1)
    expect(mocks.convert).toHaveBeenCalledTimes(1)
    expect([...mocks.files.values()].join('')).not.toContain('AQ.fake-key')
  })
  it('chunks a long recording and stitches timestamps into the original timebase', async () => {
    diarize.mockResolvedValue({ duration: 400, turns: [{ start: 0, end: 400, speaker: 0 }], embeddings: [{ speaker: 0, vector: [1, 0] }] })
    mocks.preflight.mockResolvedValue({ status: 'speech_present', durationSeconds: 400, activityIntervals: [{ start: 0, end: 400 }] })
    const result = await new LocalTranscriptionBackend(() => client, diarize, models).process(input, observer)
    expect(client.transcribe).toHaveBeenCalledTimes(3)
    expect(result.segments.map(segment => segment.start)).toEqual([2, 181, 361])
    expect(vi.mocked(client.transcribe).mock.calls.every(call => call[1].duration <= 182)).toBe(true)
  })
  it('saves a local timestamped transcript with no credentials or summary provider', async () => {
    const providers = vi.fn(() => client)
    const result = await new LocalTranscriptionBackend(providers, diarize, models).process({ ...input, settings: structuredClone(DEFAULT_AI_SETTINGS), keys: { gemini: null, openai: null }, summaryReady: false }, observer)
    expect(result.segments.length).toBeGreaterThan(0)
    expect(result.summary).toBeNull()
    expect(providers).toHaveBeenCalledWith('local', undefined)
    expect(client.summarize).not.toHaveBeenCalled()
    expect(observer.checkpoint).toHaveBeenCalledOnce()
  })
  it('prepares transcription models before expensive speaker detection and forwards real section progress', async () => {
    const order: string[] = []
    client.prepare = vi.fn(async () => { order.push('models') })
    diarize.mockImplementation(async (_path, _models, _signal, progress) => { order.push('speakers'); progress(0.5, 'Detected speakers in 1 of 2 sections.'); return { duration: 20, turns: [{ start: 0, end: 20, speaker: 0 }], embeddings: [{ speaker: 0, vector: [1, 0] }] } })
    await new LocalTranscriptionBackend(() => client, diarize, models).process(input, observer)
    expect(order).toEqual(['models', 'speakers'])
    expect(observer.stage).toHaveBeenCalledWith('diarizing', expect.closeTo(0.6), 'Detected speakers in 1 of 2 sections.')
  })
  it('combines local section progress with the outer audio-part position', async () => {
    vi.mocked(client.transcribe).mockImplementation(async (_model, chunk) => { chunk.progress?.('Transcribed one local section.', 0.5); return { text: 'Send it.', words: [], segments: [{ start: 1, end: 2, text: 'Send it.' }] } })
    await new LocalTranscriptionBackend(() => client, diarize, models).process(input, observer)
    expect(observer.stage).toHaveBeenCalledWith('transcribing', 0.5, 'Part 1 of 1 · Transcribed one local section.')
  })
  it('reuses audio preflight and speaker analysis after a transcription failure', async () => {
    vi.mocked(client.transcribe).mockRejectedValueOnce(new ProcessingError('Decoding interrupted.'))
    const backend = new LocalTranscriptionBackend(() => client, diarize, models)
    await expect(backend.process(input, observer)).rejects.toThrow('Decoding interrupted')
    await backend.process(input, observer)
    expect(diarize).toHaveBeenCalledOnce()
    expect(mocks.preflight).toHaveBeenCalledOnce()
    expect(observer.stage).toHaveBeenCalledWith('diarizing', 1, 'Reusing saved local speaker analysis…')
  })
  it('retains speaker analysis when the transcription model is changed', async () => {
    const backend = new LocalTranscriptionBackend(() => client, diarize, models)
    await backend.process(input, observer)
    await backend.process({ ...input, settings: { ...input.settings, transcription: { provider: 'local', model: 'whisper-base' } } }, observer)
    expect(diarize).toHaveBeenCalledOnce()
    expect(mocks.preflight).toHaveBeenCalledOnce()
    expect(client.transcribe).toHaveBeenCalledTimes(2)
    expect(vi.mocked(client.transcribe).mock.calls[1][1]).toMatchObject({ activityIntervals: [{ start: 0, end: 20 }], checkpointDirectory: expect.stringContaining('chunk-0-sections') })
  })
  it('does not reuse voice analysis when the verified source checksum changes', async () => {
    const backend = new LocalTranscriptionBackend(() => client, diarize, models)
    await backend.process(input, observer)
    mocks.checksum.mockResolvedValue('new-checksum')
    await backend.process({ ...input, checksum: 'new-checksum' }, observer)
    expect(diarize).toHaveBeenCalledTimes(2)
    expect(mocks.preflight).toHaveBeenCalledTimes(2)
  })
  it('resummarizes the saved transcript without reading audio, preparing models, transcribing or requiring a transcription key', async () => {
    const backend = new LocalTranscriptionBackend(() => client, diarize, models)
    const checkpoint = { duration: 20, speakers: [], segments: [{ id: 's', start: 1, end: 2, text: 'Send the plan.', speakerId: null, speakerName: null }] }
    const result = await backend.process({ ...input, savedTranscript: checkpoint, settings: { ...input.settings, transcription: { provider: 'openai', model: 'whisper-1' } } }, observer)
    expect(result).toMatchObject({ ...checkpoint, transcriptChanged: false })
    expect(client.summarize).toHaveBeenCalledOnce()
    expect(client.transcribe).not.toHaveBeenCalled(); expect(mocks.checksum).not.toHaveBeenCalled(); expect(mocks.convert).not.toHaveBeenCalled(); expect(diarize).not.toHaveBeenCalled(); expect(models).not.toHaveBeenCalled(); expect(observer.checkpoint).not.toHaveBeenCalled()
  })
  it('explicit retranscription bypasses old transcript caches and resummarizes, while a retry of the same generation resumes', async () => {
    const backend = new LocalTranscriptionBackend(() => client, diarize, models)
    await backend.process(input, observer)
    vi.mocked(client.summarize).mockRejectedValueOnce(new ProcessingError('Summary interrupted.'))
    await expect(backend.process({ ...input, generation: 'retranscribe-1' }, observer)).rejects.toThrow('Summary interrupted')
    await backend.process({ ...input, generation: 'retranscribe-1' }, observer)
    expect(client.transcribe).toHaveBeenCalledTimes(2)
    expect(client.summarize).toHaveBeenCalledTimes(3)
    expect(diarize).toHaveBeenCalledOnce()
    expect(mocks.preflight).toHaveBeenCalledOnce()
  })
  it('keeps speaker identities attached to voices when native cluster numbers swap', async () => {
    diarize.mockResolvedValueOnce({ duration: 20, turns: [{ start: 0, end: 10, speaker: 0 }, { start: 10, end: 20, speaker: 1 }], embeddings: [{ speaker: 0, vector: [1, 0] }, { speaker: 1, vector: [0, 1] }] })
    diarize.mockResolvedValueOnce({ duration: 20, turns: [{ start: 0, end: 10, speaker: 1 }, { start: 10, end: 20, speaker: 0 }], embeddings: [{ speaker: 0, vector: [0, 1] }, { speaker: 1, vector: [1, 0] }] })
    const backend = new LocalTranscriptionBackend(() => client, diarize, models)
    const first = await backend.process(input, observer), second = await backend.process({ ...input, expectedSpeakers: 2 }, observer)
    expect(first.speakers[0].id).toBe(second.speakers[1].id)
    expect(first.speakers[1].id).toBe(second.speakers[0].id)
  })
})
