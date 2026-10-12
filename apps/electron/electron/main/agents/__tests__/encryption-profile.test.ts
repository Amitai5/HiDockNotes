import { describe, expect, it, vi } from 'vitest'
import { waitForWindowsEncryptionProfile } from '../encryption-profile'

describe('Windows MCP encryption profile readiness', () => {
  const ready = JSON.stringify({ os_crypt: { encrypted_key: 'os-encrypted-key' } })
  it('starts immediately when the encrypted key has already been persisted', async () => {
    const pause = vi.fn()
    await waitForWindowsEncryptionProfile(async () => ready, pause)
    expect(pause).not.toHaveBeenCalled()
  })
  it('waits for a fresh profile to persist its key without creating or replacing one', async () => {
    const read = vi.fn().mockRejectedValueOnce(Object.assign(new Error(), { code: 'ENOENT' })).mockResolvedValueOnce('{}').mockResolvedValue(ready)
    const pause = vi.fn().mockResolvedValue(undefined)
    await waitForWindowsEncryptionProfile(read, pause)
    expect(read).toHaveBeenCalledTimes(3)
    expect(pause).toHaveBeenCalledTimes(2)
  })
  it('tolerates a preference write that has not completed', async () => {
    const read = vi.fn().mockResolvedValueOnce('{').mockResolvedValue(ready)
    await waitForWindowsEncryptionProfile(read, async () => {})
    expect(read).toHaveBeenCalledTimes(2)
  })
  it('bounds startup when the desktop profile is unavailable', async () => {
    const read = vi.fn().mockResolvedValue('{"os_crypt":{"encrypted_key":null}}')
    const pause = vi.fn().mockResolvedValue(undefined)
    await expect(waitForWindowsEncryptionProfile(read, pause, 3)).rejects.toThrow('not ready')
    expect(read).toHaveBeenCalledTimes(3)
    expect(pause).toHaveBeenCalledTimes(2)
  })
  it('fails without exposing filesystem error details', async () => {
    const pause = vi.fn()
    await expect(waitForWindowsEncryptionProfile(async () => { throw Object.assign(new Error('/private/location'), { code: 'EACCES' }) }, pause)).rejects.toThrow('The app encryption profile could not be read.')
    expect(pause).not.toHaveBeenCalled()
  })
})
