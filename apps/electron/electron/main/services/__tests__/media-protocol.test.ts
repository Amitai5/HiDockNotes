import { describe, expect, it } from 'vitest'
import { parseRange } from '../media-protocol'

describe('audio seek ranges', () => {
  it('streams the whole file without a range', () => expect(parseRange(null, 100)).toEqual({ start: 0, end: 99, partial: false }))
  it('supports open and bounded byte ranges', () => {
    expect(parseRange('bytes=20-', 100)).toEqual({ start: 20, end: 99, partial: true })
    expect(parseRange('bytes=20-39', 100)).toEqual({ start: 20, end: 39, partial: true })
  })
  it('supports suffix ranges', () => expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99, partial: true }))
  it.each(['bytes=100-', 'bytes=40-20', 'bytes=0-1,2-3', 'bytes=-', 'bytes=9007199254740992-'])('refuses malformed or unsatisfiable range %s', value => expect(() => parseRange(value, 100)).toThrow())
})
