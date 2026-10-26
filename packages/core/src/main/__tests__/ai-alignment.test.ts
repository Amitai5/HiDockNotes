import { describe, expect, it } from 'vitest'
import { alignTranscript, planChunks, speakerForTime, stitchChunk } from '../ai/alignment'
import { cosineSimilarity, embeddingBytes, embeddingFromBytes, matchVoice, normalizeEmbedding } from '../ai/voice-matching'
import { verifyDigest } from '../ai/model-cache'

describe('local timing and voice recognition', () => {
  it('covers long audio with bounded overlap and keeps each overlap word once', () => {
    const chunks = planChunks(400)
    expect(chunks).toHaveLength(3)
    expect(chunks[1]).toEqual({ start: 179, end: 361, keepStart: 180, keepEnd: 360 })
    const first = stitchChunk([{ start: 179.5, end: 180.5, text: 'boundary' }], chunks[0])
    const second = stitchChunk([{ start: 0.5, end: 1.5, text: 'boundary' }], chunks[1])
    expect([...first, ...second]).toEqual([{ start: 179.5, end: 180.5, text: 'boundary' }])
  })
  it('assigns by strongest time overlap and keeps speaker changes as separate segments', () => {
    const turns = [{ start: 0, end: 1, speaker: 0 }, { start: 1, end: 3, speaker: 1 }]
    expect(speakerForTime({ start: 0.8, end: 1.8, text: 'Hello' }, turns)).toBe(1)
    const result = alignTranscript('rec', [{ start: 0, end: 0.5, text: 'Hi.' }, { start: 1, end: 1.5, text: 'Hello' }, { start: 1.5, end: 2, text: 'Dana.' }], turns, new Map([[0, 'Dana'], [1, 'Alex']]), true)
    expect(result.map(s => [s.text, s.speakerName])).toEqual([['Hi.', 'Dana'], ['Hello Dana.', 'Alex']])
    expect(result[0].speakerId).not.toBe(result[1].speakerId)
  })
  it('does not invent a speaker for speech outside diarized turns', () => {
    expect(speakerForTime({ start: 8, end: 9, text: 'Noise?' }, [{ start: 0, end: 1, speaker: 0 }])).toBeNull()
  })
  it('bridges a short timing hole only when the same native speaker surrounds it', () => {
    const item = { start: 2.1, end: 2.2, text: 'Yes.' }
    expect(speakerForTime(item, [{ start: 0, end: 2, speaker: 0 }, { start: 2.3, end: 4, speaker: 0 }])).toBe(0)
    expect(speakerForTime(item, [{ start: 0, end: 2, speaker: 0 }, { start: 2.3, end: 4, speaker: 1 }])).toBeNull()
    expect(speakerForTime(item, [{ start: 0, end: 1, speaker: 0 }, { start: 3, end: 4, speaker: 0 }])).toBeNull()
    expect(speakerForTime(item, [{ start: 0, end: 2, speaker: 0 }, { start: 2.3, end: 4, speaker: 0 }, { start: 1.5, end: 2, speaker: 1 }])).toBeNull()
  })
  it('keeps long unmatched passages unassigned rather than guessing the previous voice', () => {
    const result = alignTranscript('rec', [{ start: 2, end: 8, text: 'Uncertain passage.' }], [{ start: 0, end: 1.9, speaker: 0 }, { start: 8.1, end: 10, speaker: 0 }], new Map([[0, 'Dana']]), false)
    expect(result[0]).toMatchObject({ speakerId: null, speakerName: 'Unassigned speech', text: 'Uncertain passage.', start: 2, end: 8 })
  })
  it('compares all profile samples and distinguishes auto, suggestion and unknown', () => {
    const profiles = [{ id: 'dana', name: 'Dana', embeddings: [[0, 1], [1, 0]] }]
    expect(matchVoice([1, 0], profiles, 'Speaker 1', 0.6, 0.75)).toMatchObject({ profileId: 'dana', label: 'Dana' })
    expect(matchVoice([0.7, Math.sqrt(0.51)], [{ ...profiles[0], embeddings: [[1, 0]] }], 'Speaker 1', 0.6, 0.75)).toMatchObject({ profileId: null, suggestedId: 'dana', label: 'Speaker 1' })
    expect(matchVoice([0, 1], [{ ...profiles[0], embeddings: [[1, 0]] }], 'Speaker 1', 0.6, 0.75).suggestedId).toBeNull()
  })
  it('normalizes portable float embeddings and rejects malformed or mismatched samples', () => {
    expect(embeddingFromBytes(embeddingBytes([3, 4]))).toEqual(expect.arrayContaining([expect.closeTo(0.6), expect.closeTo(0.8)]))
    expect(cosineSimilarity([1, 0], [1])).toBeNull()
    expect(normalizeEmbedding([NaN])).toBeNull()
    expect(normalizeEmbedding([0, 0])).toBeNull()
    expect(embeddingFromBytes(Buffer.from([1]))).toEqual([])
  })
  it('blocks mismatched model bytes instead of silently loading them', () => {
    expect(() => verifyDigest('wrong', 'pinned')).toThrow('checksum')
    expect(() => verifyDigest('same', 'same')).not.toThrow()
  })
})
