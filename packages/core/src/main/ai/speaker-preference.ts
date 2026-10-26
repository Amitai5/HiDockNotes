import type { DiarizedAudio } from './local-diarization'
import { cosineSimilarity, normalizeEmbedding } from './voice-matching'

export const SPEAKER_ANALYSIS_VERSION = 'speakers-v4'
export const PREFERRED_AUTOMATIC_SPEAKERS = 3
export const AUTOMATIC_CLUSTER_THRESHOLD = 0.75

/** A soft prior: merge small, acoustically clear fragments, never force a fixed headcount. */
export function preferFewerSpeakers(audio: DiarizedAudio): DiarizedAudio {
  let embeddings = audio.embeddings.map(voice => ({ ...voice })), turns = audio.turns
  const weights = new Map(embeddings.map(voice => [voice.speaker, 0]))
  for (const turn of turns) weights.set(turn.speaker, (weights.get(turn.speaker) ?? 0) + turn.end - turn.start)
  const conflicts = new Map(embeddings.map(voice => [voice.speaker, new Set<number>()]))
  let active: typeof turns = []
  for (const turn of [...turns].sort((a, b) => a.start - b.start)) {
    active = active.filter(other => other.end > turn.start)
    for (const other of active) {
      if (other.speaker !== turn.speaker && Math.min(turn.end, other.end) - turn.start >= 0.25) {
        conflicts.get(turn.speaker)?.add(other.speaker); conflicts.get(other.speaker)?.add(turn.speaker)
      }
    }
    active.push(turn)
  }
  while (embeddings.length > PREFERRED_AUTOMATIC_SPEAKERS) {
    let merge: { fragment: typeof embeddings[number]; target: typeof embeddings[number]; score: number } | undefined
    for (const fragment of embeddings) {
      const weight = weights.get(fragment.speaker) ?? 0
      if (!fragment.vector || weight <= 0) continue
      const candidates = embeddings.filter(target => target.speaker !== fragment.speaker && target.vector && (weights.get(target.speaker) ?? 0) >= weight * 3)
        .filter(target => !conflicts.get(fragment.speaker)?.has(target.speaker))
        .map(target => ({ target, score: cosineSimilarity(fragment.vector!, target.vector!) ?? -1 })).sort((a, b) => b.score - a.score)
      const best = candidates[0]
      // Missing samples, a close second match, and independent substantial voices
      // stay separate. The preference must not manufacture an identity.
      if (best && best.score >= 0.72 && (!candidates[1] || best.score - candidates[1].score >= 0.12) && (!merge || best.score > merge.score)) merge = { fragment, ...best }
    }
    if (!merge) break
    const { fragment, target } = merge, sourceWeight = weights.get(fragment.speaker)!, targetWeight = weights.get(target.speaker)!
    target.vector = normalizeEmbedding(target.vector!.map((value, index) => value * targetWeight + fragment.vector![index] * sourceWeight))
    weights.set(target.speaker, sourceWeight + targetWeight)
    for (const peer of conflicts.get(fragment.speaker) ?? []) {
      conflicts.get(target.speaker)?.add(peer); conflicts.get(peer)?.delete(fragment.speaker); conflicts.get(peer)?.add(target.speaker)
    }
    conflicts.delete(fragment.speaker)
    turns = turns.map(turn => turn.speaker === fragment.speaker ? { ...turn, speaker: target.speaker } : turn)
    embeddings = embeddings.filter(voice => voice.speaker !== fragment.speaker)
  }
  return { ...audio, embeddings, turns }
}
