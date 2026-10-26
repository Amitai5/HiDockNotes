import { describe, expect, it } from 'vitest'
import { preferFewerSpeakers } from '../ai/speaker-preference'
import type { DiarizedAudio } from '../ai/local-diarization'

function audio(vectors: (number[] | null)[], weights: number[]): DiarizedAudio {
  let start = 0
  return { duration: weights.reduce((sum, weight) => sum + weight, 0), embeddings: vectors.map((vector, speaker) => ({ speaker, vector })), turns: weights.map((weight, speaker) => { const turn = { start, end: start + weight, speaker }; start += weight; return turn }) }
}

describe('soft preference for fewer automatic speakers', () => {
  it('consolidates seven fragmented clusters into three well-supported local voices without changing text timing', () => {
    const input = audio([[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, .05, 0], [1, -.05, 0], [0, 1, .05], [.05, 0, 1]], [100, 100, 100, 10, 10, 10, 10])
    const result = preferFewerSpeakers(input)
    expect(result.embeddings.map(voice => voice.speaker)).toEqual([0, 1, 2])
    expect(result.turns.map(turn => turn.speaker)).toEqual([0, 1, 2, 0, 0, 1, 2])
    expect(result.turns.map(({ start, end }) => [start, end])).toEqual(input.turns.map(({ start, end }) => [start, end]))
    expect(input.embeddings).toHaveLength(7)
    expect(input.turns[3].speaker).toBe(3)
  })
  it('keeps four substantial voices instead of forcing every meeting to three', () => {
    const input = audio([[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, .05, 0]], [100, 100, 100, 100])
    expect(preferFewerSpeakers(input)).toEqual(input)
  })
  it('keeps a brief distinct fourth voice when its acoustic sample does not match the others', () => {
    const input = audio([[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]], [100, 100, 100, 10])
    expect(preferFewerSpeakers(input)).toEqual(input)
  })
  it('does not merge a mixed voice that matches two people similarly', () => {
    const input = audio([[1, 0, 0], [.8, .6, 0], [0, 0, 1], [1, .3, 0]], [100, 100, 100, 10])
    expect(preferFewerSpeakers(input)).toEqual(input)
  })
  it('keeps simultaneous native identities separate even with similar embeddings', () => {
    const input = audio([[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, .02, 0]], [100, 100, 100, 10])
    input.turns[3] = { start: 0, end: 10, speaker: 3 }
    expect(preferFewerSpeakers(input)).toEqual(input)
  })
  it('does not guess identity from missing or incompatible embeddings', () => {
    const input = audio([null, [1, 0], [0, 1], [1, 0, 0]], [100, 100, 100, 10])
    expect(preferFewerSpeakers(input)).toEqual(input)
  })
})
