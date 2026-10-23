import { beforeEach, describe, expect, it, vi } from 'vitest'
import { diarizeRecording, retainSupportedSpeakers } from '../ai/recording-diarization'
const native = vi.hoisted(() => ({ read: vi.fn(), config: vi.fn(), process: vi.fn(), compute: vi.fn() }))
vi.mock('sherpa-onnx-node', () => ({ default: { readWave: native.read, OfflineSpeakerDiarization: class { constructor(config: unknown) { native.config(config) } process(samples: Float32Array) { return native.process(samples) } }, SpeakerEmbeddingExtractor: class { createStream() { return { acceptWaveform: vi.fn(), inputFinished: vi.fn() } } isReady() { return true } compute() { return native.compute() } } } }))
describe('recording-wide diarization', () => {
  beforeEach(() => { vi.clearAllMocks(); native.read.mockReturnValue({ sampleRate: 16000, samples: new Float32Array(20 * 16000) }); native.process.mockReturnValue([{ start: 1, end: 5, speaker: 0 }, { start: 8, end: 12, speaker: 1 }]); native.compute.mockReturnValue([1, 0]) })
  const options = { expectedSpeakers: 2, activityIntervals: [{ start: 1, end: 5 }, { start: 8, end: 12 }], read: async () => null, write: async () => undefined }
  it('clusters the entire recording once with the known count rather than forcing a count in every small section', async () => {
    const result = await diarizeRecording('/audio.wav', { segmentation: '/seg', embedding: '/emb' }, undefined, vi.fn(), options)
    expect(native.process).toHaveBeenCalledOnce()
    expect(native.process.mock.calls[0][0]).toHaveLength(20 * 16000)
    expect(native.config.mock.calls[0][0].clustering.numClusters).toBe(2)
    expect(result.embeddings).toHaveLength(2)
  })
  it('clips turns to detected speech and never creates people from empty noise sections', async () => {
    const result = await diarizeRecording('/audio.wav', { segmentation: '/seg', embedding: '/emb' }, undefined, vi.fn(), { ...options, activityIntervals: [{ start: 1, end: 3 }] })
    expect(result.embeddings).toHaveLength(1)
    expect(result.turns).toEqual([{ start: 1, end: 3.1, speaker: 0 }])
  })
  it('honors cancellation immediately after a native call without enrolling any sample', async () => {
    const controller = new AbortController(); native.process.mockImplementation(() => { controller.abort(); return [] })
    await expect(diarizeRecording('/audio.wav', { segmentation: '/seg', embedding: '/emb' }, controller.signal)).rejects.toThrow()
    expect(native.compute).not.toHaveBeenCalled()
  })
  it('rejects incompatible audio before loading the speaker model', async () => {
    native.read.mockReturnValue({ sampleRate: 8000, samples: new Float32Array(8000) })
    await expect(diarizeRecording('/audio.wav', { segmentation: '/seg', embedding: '/emb' })).rejects.toThrow('16 kHz')
    expect(native.process).not.toHaveBeenCalled()
  })
  it('leaves a short mixed-voice cluster unassigned rather than counting it as another participant', () => {
    const mixed = [Math.SQRT1_2, Math.SQRT1_2]
    const audio = { duration: 1000, embeddings: [{ speaker: 0, vector: [1, 0] }, { speaker: 1, vector: [0, 1] }, { speaker: 2, vector: mixed }], turns: [{ start: 0, end: 400, speaker: 0 }, { start: 400, end: 800, speaker: 1 }, { start: 800, end: 810, speaker: 2 }] }
    expect(retainSupportedSpeakers(audio).embeddings.map(voice => voice.speaker)).toEqual([0, 1])
    expect(retainSupportedSpeakers(audio, 3).embeddings).toHaveLength(3)
  })
})
