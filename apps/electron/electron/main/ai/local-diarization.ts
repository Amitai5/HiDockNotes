import type { DiarizationModels } from './model-cache'
import type { SpeakerTurn } from './alignment'
import { normalizeEmbedding } from './voice-matching'
import { ProcessingError } from './errors'
import { availableParallelism } from 'node:os'
import { planChunks, type ChunkPlan } from './alignment'

export interface DiarizedAudio { turns: SpeakerTurn[]; embeddings: { speaker: number; vector: number[] | null }[]; duration: number }
export interface DiarizationWindow { plan: ChunkPlan; audio: DiarizedAudio }
export interface DiarizationCheckpoints { read(index: number): Promise<unknown>; write(index: number, audio: DiarizedAudio): Promise<void>; activityIntervals: { start: number; end: number }[] }
export function isDiarizedAudio(value: unknown, duration: number): value is DiarizedAudio {
  if (!value || typeof value !== 'object') return false
  const audio = value as DiarizedAudio
  return Number.isFinite(audio.duration) && audio.duration > 0 && Math.abs(audio.duration - duration) < 0.05 && Array.isArray(audio.embeddings) && audio.embeddings.every(item => item && Number.isInteger(item.speaker) && item.speaker >= 0 && (item.vector === null || Array.isArray(item.vector) && item.vector.length > 0 && item.vector.every(Number.isFinite))) && Array.isArray(audio.turns) && audio.turns.every(turn => turn && Number.isFinite(turn.start) && Number.isFinite(turn.end) && turn.start >= 0 && turn.end > turn.start && turn.end <= audio.duration && audio.embeddings.some(item => item.speaker === turn.speaker))
}
export function mergeDiarizationWindows(windows: DiarizationWindow[], duration: number): DiarizedAudio {
  const turns: SpeakerTurn[] = [], embeddings: DiarizedAudio['embeddings'] = []
  const samples = new Map<number, number>()
  for (const { plan, audio } of windows) {
    const mapping = new Map<number, number>(), used = new Set<number>()
    // Native speaker IDs are local to each section. Match clean embeddings,
    // never the numeric IDs, and keep simultaneous speakers distinct.
    const candidates = audio.embeddings.map(local => {
      const scores = embeddings.filter(global => global.vector && local.vector && global.vector.length === local.vector.length).map(global => ({ speaker: global.speaker, score: global.vector!.reduce((sum, value, index) => sum + value * local.vector![index], 0) })).sort((a, b) => b.score - a.score)
      return { local, best: scores[0], margin: scores.length > 1 ? scores[0].score - scores[1].score : 1 }
    }).sort((a, b) => (b.best?.score ?? -1) - (a.best?.score ?? -1))
    for (const { local, best, margin } of candidates) {
      const matched = best && best.score >= 0.75 && margin >= 0.05 && !used.has(best.speaker)
      const speaker = matched ? best.speaker : embeddings.length
      mapping.set(local.speaker, speaker); used.add(speaker)
      if (!matched) { embeddings.push({ speaker, vector: local.vector }); samples.set(speaker, 1) }
      else if (local.vector) {
        const global = embeddings[speaker], count = samples.get(speaker) ?? 1
        global.vector = normalizeEmbedding(global.vector!.map((value, index) => (value * count + local.vector![index]) / (count + 1)))
        samples.set(speaker, count + 1)
      }
    }
    for (const turn of audio.turns) {
      const start = Math.max(plan.keepStart, turn.start + plan.start), end = Math.min(duration, plan.keepEnd, turn.end + plan.start)
      if (end <= start) continue
      if (!mapping.has(turn.speaker)) { mapping.set(turn.speaker, embeddings.length); embeddings.push({ speaker: embeddings.length, vector: null }) }
      turns.push({ start, end, speaker: mapping.get(turn.speaker)! })
    }
  }
  return { turns: turns.sort((a, b) => a.start - b.start), embeddings, duration }
}

export async function diarizeAudio(path: string, models: DiarizationModels, signal?: AbortSignal, progress: (fraction: number, message: string) => void = () => undefined, checkpoints?: DiarizationCheckpoints): Promise<DiarizedAudio> {
  const { default: sherpa } = await import('sherpa-onnx-node')
  signal?.throwIfAborted()
  const audio = sherpa.readWave(path, false)
  if (audio.sampleRate !== 16000 || !audio.samples.length) throw new ProcessingError('Local speaker recognition needs 16 kHz mono audio.')
  const threads = Math.max(1, Math.min(4, availableParallelism() - 1))
  let diarizer: InstanceType<typeof sherpa.OfflineSpeakerDiarization> | null = null
  let extractor: InstanceType<typeof sherpa.SpeakerEmbeddingExtractor> | null = null
  const configuration = {
    segmentation: { pyannote: { model: models.segmentation, windowShiftRatio: 0.5 }, numThreads: threads, provider: 'cpu', debug: false },
    embedding: { model: models.embedding, numThreads: threads, provider: 'cpu', debug: false },
    clustering: { numClusters: -1, threshold: 0.5 }, minDurationOn: 0.3, minDurationOff: 0.5
  }
  const duration = audio.samples.length / 16000, plans = planChunks(duration, 120, 2), windows: DiarizationWindow[] = []
  for (let index = 0; index < plans.length; index++) {
    signal?.throwIfAborted()
    const plan = plans[index], section = audio.samples.subarray(Math.floor(plan.start * 16000), Math.floor(plan.end * 16000)), sectionDuration = section.length / 16000
    if (checkpoints && !checkpoints.activityIntervals.some(activity => activity.end > plan.start && activity.start < plan.end)) {
      windows.push({ plan, audio: { duration: sectionDuration, turns: [], embeddings: [] } })
      progress((index + 1) / plans.length, `Skipped silent speaker section ${index + 1} of ${plans.length}.`)
      continue
    }
    const saved = checkpoints ? await checkpoints.read(index) : null
    signal?.throwIfAborted()
    if (isDiarizedAudio(saved, sectionDuration)) {
      windows.push({ plan, audio: saved })
      progress((index + 1) / plans.length, `Resumed saved speaker section ${index + 1} of ${plans.length}.`)
      continue
    }
    diarizer ??= new sherpa.OfflineSpeakerDiarization(configuration)
    extractor ??= new sherpa.SpeakerEmbeddingExtractor({ model: models.embedding, numThreads: threads, provider: 'cpu', debug: false })
    progress(index / plans.length, `Detecting speakers: section ${index + 1} of ${plans.length}…`)
    const turns = diarizer.process(section).filter(t => Number.isFinite(t.start) && Number.isFinite(t.end) && Number.isInteger(t.speaker) && t.end > t.start && t.start >= 0 && t.start < sectionDuration).map(t => ({ ...t, end: Math.min(t.end, sectionDuration) })).sort((a, b) => a.start - b.start)
    signal?.throwIfAborted()
    const embeddings: DiarizedAudio['embeddings'] = []
    for (const speaker of [...new Set(turns.map(t => t.speaker))]) {
      const clean = turns.filter(t => t.speaker === speaker && t.end - t.start >= 1.5 && !turns.some(other => other.speaker !== speaker && other.start < t.end && other.end > t.start)).sort((a, b) => b.end - b.start - (a.end - a.start)).slice(0, 10)
      const vectors: number[][] = []
      for (const turn of clean) {
        signal?.throwIfAborted()
        const samples = section.subarray(Math.floor(turn.start * 16000), Math.floor(Math.min(turn.end, turn.start + 10) * 16000))
        if (samples.length < 24000) continue
        const stream = extractor.createStream()
        stream.acceptWaveform({ sampleRate: 16000, samples })
        stream.inputFinished()
        if (!extractor.isReady(stream)) continue
        const vector = normalizeEmbedding(extractor.compute(stream, false))
        if (vector) vectors.push(vector)
      }
      const average = vectors.length ? normalizeEmbedding(Array.from({ length: extractor.dim }, (_, i) => vectors.reduce((sum, vector) => sum + vector[i], 0) / vectors.length)) : null
      embeddings.push({ speaker, vector: average })
    }
    const detected = { turns, embeddings, duration: sectionDuration }
    if (checkpoints) await checkpoints.write(index, detected)
    windows.push({ plan, audio: detected })
    progress((index + 1) / plans.length, `Detected speakers in ${index + 1} of ${plans.length} sections.`)
    // Let cancellation messages reach this worker between bounded native calls.
    await new Promise<void>(resolve => setImmediate(resolve))
  }
  signal?.throwIfAborted()
  return mergeDiarizationWindows(windows, duration)
}
