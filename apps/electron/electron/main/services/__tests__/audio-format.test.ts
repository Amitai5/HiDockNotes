import { describe, expect, it } from 'vitest'
import { hasConfirmedMpegHeader } from '../audio-duration'

describe('RIFF audio format detection', () => {
  it('does not mistake PCM starting with minus-one samples for MPEG', () => {
    const pcm = Buffer.alloc(1000)
    pcm.writeInt16LE(-1, 0); pcm.writeInt16LE(-3, 2)
    expect(hasConfirmedMpegHeader(pcm, 0)).toBe(false)
  })
  it('requires a second valid header at the first frame boundary', () => {
    const bytes = Buffer.alloc(44 + 576)
    Buffer.from([0xff, 0xf3, 0x88, 0xc4]).copy(bytes, 44)
    expect(hasConfirmedMpegHeader(bytes, 44)).toBe(false)
    Buffer.from([0xff, 0xf3, 0x88, 0xc4]).copy(bytes, 44 + 288)
    expect(hasConfirmedMpegHeader(bytes, 44)).toBe(true)
  })
})
