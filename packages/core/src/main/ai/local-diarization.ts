import type { DiarizationModels } from './model-cache'
import type { SpeakerTurn } from './alignment'
import { normalizeEmbedding } from './voice-matching'
import { ProcessingError } from './errors'
import { availableParallelism } from 'node:os'
import { planChunks, type ChunkPlan } from './alignment'
import { groupSpeakerFragments } from './speaker-grouping'

export interface DiarizedAudio { turns: SpeakerTurn[]; embeddings: { speaker: number; vector: number[] | null }[]; duration: number; speakerLimitReached?: boolean }
export interface DiarizationWindow { plan: ChunkPlan; audio: DiarizedAudio }
export interface DiarizationCheckpoints { read(index: number): Promise<unknown>; write(index: number, audio: DiarizedAudio): Promise<void>; activityIntervals: { start: number; end: number }[]; expectedSpeakers?: number }
export function isDiarizedAudio(value: unknown, duration: number): value is DiarizedAudio {
  if (!value || typeof value !== 'object') return false
  const audio = value as DiarizedAudio
  return Number.isFinite(audio.duration) && audio.duration > 0 && Math.abs(audio.duration - duration) < 0.05 && Array.isArray(audio.embeddings) && audio.embeddings.every(item => item && Number.isInteger(item.speaker) && item.speaker >= 0 && (item.vector === null || Array.isArray(item.vector) && item.vector.length > 0 && item.vector.every(Number.isFinite))) && Array.isArray(audio.turns) && audio.turns.every(turn => turn && Number.isFinite(turn.start) && Number.isFinite(turn.end) && turn.start >= 0 && turn.end > turn.start && turn.end <= audio.duration && audio.embeddings.some(item => item.speaker === turn.speaker))
}
export function mergeDiarizationWindows(windows: DiarizationWindow[], duration: number, expectedSpeakers?: number): DiarizedAudio {
  const fragments = windows.flatMap(({ plan, audio }, window) => audio.embeddings.map(local => ({ id: `${window}:${local.speaker}`, vector: local.vector, window,
    conflicts: audio.embeddings.filter(other => other.speaker !== local.speaker && audio.turns.some(turn => turn.speaker === local.speaker && audio.turns.some(second => second.speaker === other.speaker && Math.min(turn.end, second.end) - Math.max(turn.start, second.start) >= 0.25))).map(other => `${window}:${other.speaker}`),
    weight: audio.turns.filter(turn => turn.speaker === local.speaker).reduce((sum, turn) => sum + Math.max(0, Math.min(plan.keepEnd, turn.end + plan.start) - Math.max(plan.keepStart, turn.start + plan.start)), 0) })))
  const grouped = groupSpeakerFragments(fragments, expectedSpeakers)
  const mapping = new Map<string, number>()
  const embeddings = grouped.groups.map((group, speaker) => { for (const member of group.members) mapping.set(member, speaker); return { speaker, vector: group.vector } })
  const turns = windows.flatMap(({ plan, audio }, window) => audio.turns.flatMap(turn => {
    const start = Math.max(plan.keepStart, turn.start + plan.start), end = Math.min(duration, plan.keepEnd, turn.end + plan.start)
    const speaker = mapping.get(`${window}:${turn.speaker}`)
    return end > start && speaker !== undefined ? [{ start, end, speaker }] : []
  })).sort((a, b) => a.start - b.start)
  return { turns, embeddings, duration, speakerLimitReached: grouped.limited }
}

export function boundDiarizedAudio(audio: DiarizedAudio): DiarizedAudio {
  if (audio.embeddings.length <= 10) return audio
  const grouped = groupSpeakerFragments(audio.embeddings.map(item => ({ id: String(item.speaker), vector: item.vector, weight: audio.turns.filter(turn => turn.speaker === item.speaker).reduce((sum, turn) => sum + turn.end - turn.start, 0) })))
  const mapping = new Map<string, number>()
  const embeddings = grouped.groups.map((group, speaker) => { for (const member of group.members) mapping.set(member, speaker); return { speaker, vector: group.vector } })
  return { ...audio, speakerLimitReached: grouped.limited, embeddings, turns: audio.turns.map(turn => ({ ...turn, speaker: mapping.get(String(turn.speaker))! })) }
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
    const turns = diarizer.process(section).filter(t => Number.isFinite(t.start) && Number.isFinite(t.end) && Number.isInteger(t.speaker) && t.end > t.start && t.start >= 0 && t.start < sectionDuration).flatMap(t => {
      const end = Math.min(t.end, sectionDuration)
      if (!checkpoints) return [{ ...t, end }]
      return checkpoints.activityIntervals.flatMap(speech => {
        const start = Math.max(t.start, speech.start - plan.start - 0.1), clippedEnd = Math.min(end, speech.end - plan.start + 0.1)
        return clippedEnd > start ? [{ ...t, start, end: clippedEnd }] : []
      })
    }).sort((a, b) => a.start - b.start)
    signal?.throwIfAborted()
    const embeddings: DiarizedAudio['embeddings'] = []
    for (const speaker of [...new Set(turns.map(t => t.speaker))]) {
      const clean = turns.filter(t => t.speaker === speaker && t.end - t.start >= 0.2 && !turns.some(other => other.speaker !== speaker && other.start < t.end && other.end > t.start)).sort((a, b) => b.end - b.start - (a.end - a.start))
      const pieces: Float32Array[] = []
      let size = 0
      // Pool short, non-overlapping turns from this local voice. Rejecting every
      // turn below 1.5 seconds previously created new unidentified people per section.
      for (const turn of clean) {
        const end = Math.min(turn.end, turn.start + (320000 - size) / 16000)
        if (end <= turn.start) break
        const piece = section.subarray(Math.floor(turn.start * 16000), Math.floor(end * 16000))
        pieces.push(piece); size += piece.length
        if (size >= 320000) break
      }
      let average: number[] | null = null
      if (size >= 24000) {
        const samples = new Float32Array(size)
        let offset = 0
        for (const piece of pieces) { samples.set(piece, offset); offset += piece.length }
        signal?.throwIfAborted()
        const stream = extractor.createStream()
        stream.acceptWaveform({ sampleRate: 16000, samples }); stream.inputFinished()
        if (extractor.isReady(stream)) average = normalizeEmbedding(extractor.compute(stream, false))
      }
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
  return mergeDiarizationWindows(windows, duration, checkpoints?.expectedSpeakers)
}
