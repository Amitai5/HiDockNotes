import { beforeEach, describe, expect, it, vi } from 'vitest'
import { diarizeAudio, mergeDiarizationWindows, type DiarizationWindow } from '../ai/local-diarization'

const native = vi.hoisted(() => ({ readWave: vi.fn(), construct: vi.fn(), process: vi.fn(), compute: vi.fn() }))
vi.mock('sherpa-onnx-node', () => ({ default: {
  readWave: native.readWave,
  OfflineSpeakerDiarization: class { constructor(config: unknown) { native.construct(config) }; process(samples: Float32Array) { return native.process(samples) } },
  SpeakerEmbeddingExtractor: class { dim = 2; createStream() { return { acceptWaveform: vi.fn(), inputFinished: vi.fn() } }; isReady() { return true }; compute() { return native.compute() } }
} }))

function section(start: number, end: number, voices: number[][]): DiarizationWindow {
  return { plan: { start, end, keepStart: start, keepEnd: end }, audio: { duration: end - start, turns: voices.map((_vector, speaker) => ({ start: speaker * 4, end: speaker * 4 + 3, speaker })), embeddings: voices.map((vector, speaker) => ({ speaker, vector })) } }
}
describe('bounded local speaker detection', () => {
  beforeEach(() => { vi.clearAllMocks(); native.readWave.mockReturnValue({ sampleRate: 16000, samples: new Float32Array(250 * 16000) }); native.process.mockReturnValue([{ start: 1, end: 4, speaker: 0 }]); native.compute.mockReturnValue(new Float32Array([1, 0])) })
  it('bounds native work, reports each completed section and supplies the window shift in the actual native config', async () => {
    const progress = vi.fn()
    const result = await diarizeAudio('/public.wav', { segmentation: '/seg', embedding: '/embed' }, undefined, progress)
    expect(native.process).toHaveBeenCalledTimes(3)
    expect(native.process.mock.calls.every(([samples]) => samples.length <= 124 * 16000)).toBe(true)
    expect(native.construct.mock.calls[0][0].segmentation.pyannote.windowShiftRatio).toBe(0.5)
    expect(result.embeddings).toHaveLength(1)
    expect(result.turns.map(turn => turn.start)).toEqual([1, 120, 240])
    expect(progress).toHaveBeenLastCalledWith(1, 'Detected speakers in 3 of 3 sections.')
  })
  it('can cancel between native sections without waiting for the entire recording', async () => {
    const controller = new AbortController()
    const progress = (fraction: number): void => { if (fraction > 0) controller.abort() }
    await expect(diarizeAudio('/public.wav', { segmentation: '/seg', embedding: '/embed' }, controller.signal, progress)).rejects.toThrow()
    expect(native.process).toHaveBeenCalledTimes(1)
  })
  it('rejects incompatible audio before running native speaker detection', async () => {
    native.readWave.mockReturnValue({ sampleRate: 8000, samples: new Float32Array(8000) })
    await expect(diarizeAudio('/public.wav', { segmentation: '/seg', embedding: '/embed' })).rejects.toThrow('16 kHz')
    expect(native.process).not.toHaveBeenCalled()
  })
  it('keeps the same global voice when local speaker IDs change between sections', () => {
    const result = mergeDiarizationWindows([section(0, 120, [[1, 0], [0, 1]]), section(120, 140, [[0, 1], [1, 0]])], 140)
    expect(result.embeddings).toHaveLength(2)
    expect(result.turns.map(turn => turn.speaker)).toEqual([0, 1, 1, 0])
    expect(result.turns.map(turn => turn.start)).toEqual([0, 4, 120, 124])
  })
  it('never merges two voices from the same section into one global speaker', () => {
    const result = mergeDiarizationWindows([section(0, 120, [[1, 0]]), section(120, 140, [[1, 0], [1, 0]])], 140)
    expect(result.embeddings).toHaveLength(2)
    expect(result.turns.slice(1).map(turn => turn.speaker)).toEqual([0, 1])
  })
  it('creates a separate speaker for ambiguous matches and voices without a clean embedding', () => {
    const ambiguous = section(120, 140, [[Math.SQRT1_2, Math.SQRT1_2]])
    const result = mergeDiarizationWindows([section(0, 120, [[1, 0], [0, 1]]), ambiguous], 140)
    expect(result.embeddings).toHaveLength(3)
    ambiguous.audio.embeddings[0].vector = null
    expect(mergeDiarizationWindows([section(0, 120, [[1, 0]]), ambiguous], 140).embeddings).toHaveLength(2)
  })
  it('clips overlapping sections to ownership windows without extending past the recording', () => {
    const first = section(0, 122, [[1, 0]]), second = section(118, 130, [[1, 0]])
    first.plan.keepEnd = 120; first.audio.turns = [{ start: 118, end: 122, speaker: 0 }]
    second.plan.keepStart = 120; second.audio.turns = [{ start: 0, end: 20, speaker: 0 }]
    expect(mergeDiarizationWindows([first, second], 130).turns).toEqual([{ start: 118, end: 120, speaker: 0 }, { start: 120, end: 130, speaker: 0 }])
  })
})
