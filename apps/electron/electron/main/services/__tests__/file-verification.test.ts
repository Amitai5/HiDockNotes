// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { Recording } from '../database'
vi.mock('../database', () => ({ getRecordingByFilename: vi.fn(), markRecordingVerified: vi.fn() }))
import { getRecordingByFilename, markRecordingVerified } from '../database'
import { hasVerifiedCopy, verifyDownloadedBytes, verifySavedFile } from '../file-verification'

describe('Local file verification', () => {
  let directory: string
  let file: string
  const data = Buffer.from('complete recording')
  const checksum = createHash('sha256').update(data).digest('hex')
  beforeEach(async () => {
    vi.clearAllMocks()
    directory = await mkdtemp(join(tmpdir(), 'hidocknotes-verification-'))
    file = join(directory, 'recording.wav')
    await writeFile(file, data)
    const row: Recording & { device_serial: string } = {
      id: 'recording', filename: 'recording.hda', file_path: file, file_size: data.length,
      date_recorded: '2026-10-07T00:00:00Z', duration_seconds: 1, checksum, verified: 1,
      status: 'downloaded', title: null, project_id: null, device_serial: 'P1-A'
    }
    vi.mocked(getRecordingByFilename).mockReturnValue(row)
  })
  afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

  it('accepts a complete byte-for-byte saved download', async () => {
    await expect(verifyDownloadedBytes(file, data)).resolves.toBeUndefined()
    await verifySavedFile('recording.hda', file, 'P1-A')
    expect(markRecordingVerified).toHaveBeenCalledWith('recording.hda', checksum, 'P1-A')
  })
  it('detects corruption even when the byte count is unchanged', async () => {
    await writeFile(file, Buffer.alloc(data.length, 42))
    await expect(verifyDownloadedBytes(file, data)).rejects.toThrow('SHA-256')
    await expect(hasVerifiedCopy('recording.hda', data.length, 'P1-A')).resolves.toBe(false)
  })
  it('refuses deletion when the file belongs to another device or is incomplete', async () => {
    await expect(hasVerifiedCopy('recording.hda', data.length, 'P1-B')).resolves.toBe(false)
    await expect(hasVerifiedCopy('recording.hda', data.length + 1, 'P1-A')).resolves.toBe(false)
    await expect(hasVerifiedCopy('recording.hda', data.length, null)).resolves.toBe(false)
    await expect(hasVerifiedCopy('recording.hda', data.length, 'P1-A')).resolves.toBe(true)
  })
  it('refuses deletion when a previously verified file has been removed', async () => {
    await rm(file)
    await expect(hasVerifiedCopy('recording.hda', data.length, 'P1-A')).resolves.toBe(false)
  })
})
