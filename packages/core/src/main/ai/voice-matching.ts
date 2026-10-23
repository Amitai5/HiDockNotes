export function normalizeEmbedding(values: ArrayLike<number>): number[] | null {
  if (!values.length || values.length > 4096) return null
  const vector = Array.from(values)
  if (vector.some(v => !Number.isFinite(v))) return null
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  return norm > 1e-9 ? vector.map(v => v / norm) : null
}
export function cosineSimilarity(left: ArrayLike<number>, right: ArrayLike<number>): number | null {
  if (left.length !== right.length) return null
  const a = normalizeEmbedding(left), b = normalizeEmbedding(right)
  if (!a || !b) return null
  return Math.max(-1, Math.min(1, a.reduce((sum, value, i) => sum + value * b[i], 0)))
}
export interface VoiceCandidate { id: string; name: string; embeddings: number[][] }
export interface VoiceMatch { profileId: string | null; suggestedId: string | null; label: string; score: number | null }
export function matchVoice(embedding: number[] | null, profiles: VoiceCandidate[], fallback: string, suggest: number, auto: number): VoiceMatch {
  const matches = embedding ? profiles.map(p => ({ profile: p, score: Math.max(-1, ...p.embeddings.map(sample => cosineSimilarity(embedding, sample) ?? -1)) })).sort((a, b) => b.score - a.score) : []
  const best = matches[0]
  // Similar profiles need a confirmation even above the absolute threshold;
  // the closest of two nearly identical samples is not a reliable identity.
  if (best && best.score >= auto && (!matches[1] || best.score - matches[1].score >= 0.08)) return { profileId: best.profile.id, suggestedId: null, label: best.profile.name, score: best.score }
  if (best && best.score >= suggest) return { profileId: null, suggestedId: best.profile.id, label: fallback, score: best.score }
  return { profileId: null, suggestedId: null, label: fallback, score: best?.score ?? null }
}
export function embeddingBytes(vector: number[]): Buffer {
  const value = normalizeEmbedding(vector)
  if (!value) throw new Error('This speaker does not have a valid voice sample.')
  const buffer = Buffer.alloc(value.length * 4)
  value.forEach((v, i) => buffer.writeFloatLE(v, i * 4))
  return buffer
}
export function embeddingFromBytes(buffer: Buffer): number[] {
  if (buffer.length % 4 || buffer.length > 4096 * 4) return []
  return normalizeEmbedding(Array.from({ length: buffer.length / 4 }, (_, i) => buffer.readFloatLE(i * 4))) ?? []
}
