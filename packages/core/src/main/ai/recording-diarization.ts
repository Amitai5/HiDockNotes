import { availableParallelism } from 'node:os'
import type { DiarizationModels } from './model-cache'
import { boundDiarizedAudio, type DiarizationCheckpoints, type DiarizedAudio } from './local-diarization'
import { normalizeEmbedding } from './voice-matching'
import { ProcessingError } from './errors'
import { AUTOMATIC_CLUSTER_THRESHOLD, preferFewerSpeakers } from './speaker-preference'

/** Reject brief/mixed noise; keep supported anonymous turns even without an enrollable voice sample. */
export function retainSupportedSpeakers(audio: DiarizedAudio, expectedSpeakers?: number): DiarizedAudio {
  if (expectedSpeakers !== undefined) return boundDiarizedAudio(audio)
  // A genuine brief attendee must not disappear just because the meeting is long.
  const minimum = 3
  const weights = new Map(audio.embeddings.map(voice => [voice.speaker, audio.turns.filter(turn => turn.speaker === voice.speaker).reduce((sum, turn) => sum + turn.end - turn.start, 0)]))
  const supported = audio.embeddings.filter(voice => weights.get(voice.speaker)! >= minimum)
  const ids = new Set(supported.filter(voice => {
    if (!voice.vector || weights.get(voice.speaker)! >= audio.duration * 0.02) return true
    const scores = supported.filter(other => other.vector && other.speaker !== voice.speaker && weights.get(other.speaker)! >= weights.get(voice.speaker)! * 3).map(other => voice.vector!.reduce((sum, value, index) => sum + value * other.vector![index], 0)).sort((a, b) => b - a)
    // A small cluster equally similar to two established voices is often
    // overlapping/mixed audio. Leave its text unassigned instead of inventing
    // another person or enrolling that mixture as a voice sample.
    return !(scores.length >= 2 && scores[1] >= 0.35 && scores[0] - scores[1] < 0.15)
  }).map(voice => voice.speaker))
  return boundDiarizedAudio(preferFewerSpeakers({ ...audio, embeddings: audio.embeddings.filter(voice => ids.has(voice.speaker)), turns: audio.turns.filter(turn => ids.has(turn.speaker)) }))
}

/** Native clustering sees the entire recording, so section boundaries cannot invent new people. */
export async function diarizeRecording(path: string, models: DiarizationModels, signal?: AbortSignal, progress: (fraction: number, message: string) => void = () => undefined, options?: DiarizationCheckpoints): Promise<DiarizedAudio> {
  const { default: sherpa } = await import('sherpa-onnx-node')
  signal?.throwIfAborted()
  const wave = sherpa.readWave(path, false)
  if (wave.sampleRate !== 16000 || !wave.samples.length) throw new ProcessingError('Speaker recognition requires 16 kHz mono audio.')
  const threads = Math.max(1, Math.min(4, availableParallelism() - 1)), duration = wave.samples.length / 16000
  // Keep the original timebase, but prevent background sounds from entering
  // native clustering as extra voices. Only this in-memory copy is masked.
  if (options) {
    let position = 0
    for (const turn of [...options.activityIntervals].sort((a, b) => a.start - b.start)) {
      const start = Math.max(position, Math.floor(Math.max(0, turn.start - 0.2) * 16000))
      wave.samples.fill(0, position, start)
      position = Math.max(position, Math.min(wave.samples.length, Math.ceil((turn.end + 0.2) * 16000)))
    }
    wave.samples.fill(0, position)
  }
  const diarizer = new sherpa.OfflineSpeakerDiarization({ segmentation: { pyannote: { model: models.segmentation, windowShiftRatio: 0.5 }, numThreads: threads, provider: 'cpu', debug: false }, embedding: { model: models.embedding, numThreads: threads, provider: 'cpu', debug: false }, clustering: { numClusters: options?.expectedSpeakers ?? -1, threshold: AUTOMATIC_CLUSTER_THRESHOLD }, minDurationOn: 0.3, minDurationOff: 0.5 })
  progress(0, 'Clustering voices across the whole recording locally. Long meetings can take several minutes…')
  const native = diarizer.process(wave.samples)
  signal?.throwIfAborted()
  const turns = native.filter(turn => Number.isFinite(turn.start) && Number.isFinite(turn.end) && turn.start >= 0 && turn.end > turn.start && turn.start < duration && Number.isInteger(turn.speaker) && turn.speaker >= 0).flatMap(turn => {
    const end = Math.min(duration, turn.end)
    if (!options) return [{ ...turn, end }]
    return options.activityIntervals.flatMap(speech => {
      const start = Math.max(turn.start, speech.start - 0.1), clippedEnd = Math.min(end, speech.end + 0.1)
      return clippedEnd > start ? [{ ...turn, start, end: clippedEnd }] : []
    })
  }).sort((a, b) => a.start - b.start)
  const extractor = new sherpa.SpeakerEmbeddingExtractor({ model: models.embedding, numThreads: threads, provider: 'cpu', debug: false })
  const ids = [...new Set(turns.map(turn => turn.speaker))], embeddings: DiarizedAudio['embeddings'] = []
  for (const [index, speaker] of ids.entries()) {
    signal?.throwIfAborted()
    const clean = turns.filter(turn => turn.speaker === speaker && turn.end - turn.start >= 1.5 && !turns.some(other => other.speaker !== speaker && other.start < turn.end && other.end > turn.start)).sort((a, b) => (b.end - b.start) - (a.end - a.start)).slice(0, 5)
    const vectors: number[][] = []
    for (const turn of clean) {
      const stream = extractor.createStream()
      stream.acceptWaveform({ sampleRate: 16000, samples: wave.samples.subarray(Math.floor(turn.start * 16000), Math.floor(Math.min(turn.end, turn.start + 6) * 16000)) }); stream.inputFinished()
      if (extractor.isReady(stream)) { const vector = normalizeEmbedding(extractor.compute(stream, false)); if (vector) vectors.push(vector) }
      await new Promise<void>(resolve => setImmediate(resolve)); signal?.throwIfAborted()
    }
    // Use a medoid to reject contaminated samples before averaging. A single
    // outlier or overlapping turn must not poison a remembered voice.
    const medoid = vectors.map(vector => ({ vector, score: vectors.reduce((sum, other) => sum + vector.reduce((value, entry, k) => value + entry * other[k], 0), 0) })).sort((a, b) => b.score - a.score)[0]?.vector
    const consistent = medoid ? vectors.filter(vector => vector.reduce((sum, value, k) => sum + value * medoid[k], 0) >= 0.65) : []
    const vector = consistent.length ? normalizeEmbedding(consistent[0].map((_value, k) => consistent.reduce((sum, sample) => sum + sample[k], 0))) : null
    embeddings.push({ speaker, vector })
    progress(0.8 + 0.2 * (index + 1) / ids.length, `Checked clean voice samples for ${index + 1} of ${ids.length} speakers.`)
  }
  return retainSupportedSpeakers({ turns, embeddings, duration }, options?.expectedSpeakers)
}
