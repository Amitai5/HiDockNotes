import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomId } from '../../../src/shared/ids'

afterEach(() => vi.unstubAllGlobals())
describe('secure note identifiers on HTTP LAN origins', () => {
  it('uses native UUID generation when available', () => {
    vi.stubGlobal('crypto', { randomUUID: () => '11111111-1111-4111-8111-111111111111' })
    expect(randomId()).toBe('11111111-1111-4111-8111-111111111111')
  })
  it('uses secure random bytes when randomUUID is unavailable on an HTTP origin', () => {
    const fill = vi.fn((bytes: Uint8Array) => { bytes.fill(255); return bytes })
    vi.stubGlobal('crypto', { getRandomValues: fill })
    expect(randomId()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff'); expect(fill).toHaveBeenCalledTimes(1)
  })
  it('fails explicitly without cryptographic randomness instead of using predictable IDs', () => {
    vi.stubGlobal('crypto', {})
    expect(() => randomId()).toThrow('secure note identifiers')
  })
})
