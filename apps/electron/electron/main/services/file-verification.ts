import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { getRecordingByFilename, markRecordingVerified } from './database'

export async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}
export async function verifyDownloadedBytes(filePath: string, received: Buffer): Promise<void> {
  const expected = createHash('sha256').update(received).digest('hex')
  if ((await stat(filePath)).size !== received.length || await hashFile(filePath) !== expected) throw new Error('The saved file failed its SHA-256 verification. The device copy has been retained.')
}
export async function verifySavedFile(filename: string, localPath: string, serial: string | null): Promise<void> {
  const row = getRecordingByFilename(filename)
  if (!row || (await stat(localPath)).size !== row.file_size) throw new Error('Local recording size does not match the complete download.')
  const checksum = await hashFile(localPath)
  markRecordingVerified(filename, checksum, serial)
}
export async function hasVerifiedCopy(filename: string, expectedSize: number, serial: string | null): Promise<boolean> {
  const row = getRecordingByFilename(filename)
  if (!row?.file_path || !row.verified || !row.checksum || !serial) return false
  const binding = row as typeof row & { device_serial: string | null }
  if (binding.device_serial !== serial || row.file_size !== expectedSize) return false
  try {
    const before = await stat(row.file_path)
    if (!before.isFile() || before.size !== expectedSize) return false
    const checksum = await hashFile(row.file_path)
    const after = await stat(row.file_path)
    return checksum === row.checksum && after.size === before.size && after.mtimeMs === before.mtimeMs
  } catch { return false }
}
