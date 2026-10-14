import { describe, expect, it } from 'vitest'
import { groupSpeakerFragments } from '../ai/speaker-grouping'
import { boundDiarizedAudio, mergeDiarizationWindows } from '../ai/local-diarization'

describe('recording-local speaker identity bounds', () => {
  it('reuses an unidentified voice across hundreds of sections without inventing people', () => {
    const fragments = Array.from({ length: 300 }, (_, index) => ({ id: String(index), vector: null, weight: 2, window: index }))
    const result = groupSpeakerFragments(fragments)
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].members).toHaveLength(300)
  })
  it('groups variations of two recurring voices independently of section-local IDs', () => {
    const result = groupSpeakerFragments(Array.from({ length: 250 }, (_, index) => ({ id: String(index), vector: index % 2 ? [0.05, 1, 0] : [1, 0.05, 0], weight: 2, window: index })))
    expect(result.groups).toHaveLength(2)
    expect(result.groups.map(group => group.members.length)).toEqual([125, 125])
  })
  it('keeps at most ten ambiguous groups and prevents contaminated overflow from becoming a voice sample', () => {
    const result = groupSpeakerFragments(Array.from({ length: 250 }, (_, index) => ({ id: String(index), vector: Array.from({ length: 250 }, (_, axis) => Number(index === axis)), weight: 2 })))
    expect(result.groups).toHaveLength(10)
    expect(result.limited).toBe(true)
    expect(result.groups.reduce((count, group) => count + group.members.length, 0)).toBe(250)
    expect(result.groups.filter(group => group.members.length > 1).every(group => group.vector === null)).toBe(true)
  })
  it('preserves ten confirmed names and leaves extra uncertain speech unassigned', () => {
    const known = Array.from({ length: 10 }, (_, index) => ({ id: String(index), identity: `profile-${index}`, vector: null, weight: 2 }))
    const result = groupSpeakerFragments([...known, { id: 'unknown', vector: null, weight: 100 }])
    expect(result.groups.map(group => group.identity)).toEqual(known.map(item => item.identity))
    expect(result.unassigned).toEqual(['unknown'])
    expect(result.limited).toBe(true)
  })
  it('preserves turn timing while repairing a legacy cached transcript with hundreds of speakers', () => {
    const turns = Array.from({ length: 240 }, (_, speaker) => ({ start: speaker, end: speaker + 0.8, speaker }))
    const result = boundDiarizedAudio({ duration: 240, turns, embeddings: turns.map(turn => ({ speaker: turn.speaker, vector: null })) })
    expect(result.embeddings).toHaveLength(1)
    expect(result.turns.map(({ start, end }) => [start, end])).toEqual(turns.map(({ start, end }) => [start, end]))
  })
  it('reuses short unknown turns across sections while keeping simultaneous native identities distinct', () => {
    const windows = Array.from({ length: 120 }, (_, index) => ({ plan: { start: index * 2, end: index * 2 + 2, keepStart: index * 2, keepEnd: index * 2 + 2 }, audio: { duration: 2, turns: [{ start: 0, end: 1, speaker: 0 }, { start: 1, end: 2, speaker: 1 }], embeddings: [{ speaker: 0, vector: null }, { speaker: 1, vector: null }] } }))
    const result = mergeDiarizationWindows(windows, 240)
    expect(result.embeddings).toHaveLength(2)
    expect(result.turns).toHaveLength(240)
    expect(new Set(result.turns.slice(0, 2).map(turn => turn.speaker)).size).toBe(2)
  })
})
