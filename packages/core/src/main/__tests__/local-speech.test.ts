import { describe, expect, it } from 'vitest'
import { decoderArtifactReason, filterSpeechTranscript, hasSpeechSupport, isSpeechIntervals } from '../ai/local-speech'

describe('speech-supported transcripts', () => {
  it('drops noise hallucinations while preserving a real short acknowledgement', () => {
    const real = { start: 1, end: 1.4, text: 'Okay.' }, garbage = { start: 32, end: 59, text: 'x 2” '.repeat(50) }
    expect(filterSpeechTranscript([real, garbage, { start: 59, end: 62, text: '[Ambient]' }], [{ start: 1.1, end: 1.35 }])).toEqual([real])
  })
  it('removes a sustained decoder loop despite isolated false VAD hits', () => {
    const loop = Array.from({ length: 12 }, (_, index) => ({ start: index + 76, end: index + 77, text: 'Okay.' }))
    expect(filterSpeechTranscript(loop, [{ start: 78.1, end: 78.5 }])).toEqual([])
    expect(filterSpeechTranscript(loop, [{ start: 76, end: 88 }])).toEqual(loop)
  })
  it('retains boundary words with a small timing tolerance but excludes unsupported text', () => {
    expect(hasSpeechSupport({ start: 1, end: 1.3 }, [{ start: 1.4, end: 2 }])).toBe(true)
    expect(hasSpeechSupport({ start: 0, end: 0.3 }, [{ start: 1.4, end: 2 }])).toBe(false)
  })
  it('validates cached intervals against the real audio duration', () => {
    expect(isSpeechIntervals([], 10)).toBe(true)
    expect(isSpeechIntervals([{ start: 1, end: 2 }], 10)).toBe(true)
    for (const value of [null, [{ start: -1, end: 2 }], [{ start: 1, end: Infinity }], [{ start: 1, end: 11 }]]) expect(isSpeechIntervals(value, 10)).toBe(false)
  })
  it('rejects sustained numeric decoder loops even when noise produces a false VAD hit', () => {
    const garbage = { start: 5088, end: 5115, text: '1/2" ' + 'x 2" '.repeat(50) + 'x' }
    expect(decoderArtifactReason(garbage.text)).toBe('numeric-decoder-loop')
    expect(filterSpeechTranscript([garbage], [{ start: 5088, end: 5115 }])).toEqual([])
  })
  it.each(['The frame is 1/2" x 2" x 2".', '1/2" x 2" x 2"', 'Okay. Okay. Okay. Okay. Okay. Okay.', '2 4 6 8 10 12 14 16 18 20', 'Two by four. '.repeat(20)])('preserves real language, dimensions and non-repeating numbers: %s', text => {
    expect(decoderArtifactReason(text)).toBeNull()
  })
})
