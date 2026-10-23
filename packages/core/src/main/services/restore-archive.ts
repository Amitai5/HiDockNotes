import { createReadStream } from 'node:fs'
import { mkdir, open, readFile, statfs } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import { createGunzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import type { ArchivedFile } from './backup-archive'

export interface BackupManifest {
  format: 'hidocknotes-library-backup'; formatVersion: 1; appVersion: string; databaseSchema: number; createdAt: string
  counts: Record<string, number>; changedAudio: number; files: ArchivedFile[]
  recordings: { recordingId: string | null; deviceFilename: string; originalPath: string | null; archivePath: string | null; expectedSha256: string | null }[]
}
class ArchiveReader {
  private remaining = Buffer.alloc(0)
  private readonly iterator: AsyncIterator<Buffer>
  constructor(stream: AsyncIterable<Buffer>) { this.iterator = stream[Symbol.asyncIterator]() }
  async read(size: number): Promise<Buffer> {
    const chunks: Buffer[] = []; let needed = size
    while (needed) {
      if (!this.remaining.length) {
        const next = await this.iterator.next()
        if (next.done) throw new Error('The backup archive is truncated.')
        this.remaining = next.value
      }
      const count = Math.min(needed, this.remaining.length)
      chunks.push(this.remaining.subarray(0, count)); this.remaining = this.remaining.subarray(count); needed -= count
    }
    return chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, size)
  }
  async finish(): Promise<void> {
    let trailing = this.remaining.length
    if (trailing > 1024 || this.remaining.some(byte => byte !== 0)) throw new Error('Unexpected data after the archive end.')
    for (;;) { const value = await this.iterator.next(); if (value.done) break; trailing += value.value.length; if (trailing > 1024 || value.value.some(byte => byte !== 0)) throw new Error('Unexpected data after the archive end.') }
  }
}
function octal(bytes: Buffer): number {
  const value = bytes.toString('ascii').replace(/\0.*$/, '').trim()
  if (!/^[0-7]+$/.test(value)) throw new Error('Invalid archive file size or checksum.')
  const number = Number.parseInt(value, 8)
  if (!Number.isSafeInteger(number)) throw new Error('Invalid archive size.')
  return number
}
function entryName(header: Buffer): string {
  const name = header.subarray(0, 100).toString('utf8').split('\0')[0]
  if (!/^(data\/library\.db|data\/agent-connection\.bin|recordings\/audio-[0-9]+\.[a-z0-9]{1,10}|manifest\.json|README\.txt)$/.test(name) || header.subarray(345, 500).some(byte => byte !== 0)) throw new Error('The backup contains an unsupported or unsafe path.')
  if (header[156] !== 48 || header.subarray(157, 257).some(byte => byte !== 0) || header.subarray(257, 263).toString() !== 'ustar\0') throw new Error('Only regular files in HiDockNotes backups can be restored.')
  const check = Buffer.from(header); check.fill(32, 148, 156)
  if (check.reduce((sum, byte) => sum + byte, 0) !== octal(header.subarray(148, 156))) throw new Error('An archive header failed its checksum.')
  return name
}
/** Streaming extraction into a fresh, application-owned directory; never follows archive links. */
export async function extractVerifiedBackup(source: string, directory: string, signal: AbortSignal, progress: (bytes: number) => void): Promise<BackupManifest> {
  const files = new Map<string, ArchivedFile>()
  const disk = await statfs(directory), budget = Math.min(Number(disk.bavail) * Number(disk.bsize) - 512 * 1024 ** 2, 512 * 1024 ** 3)
  let allocated = 0, completed = 0
  const input = createReadStream(source), unzip = createGunzip()
  const task = pipeline(input, unzip, { signal }); void task.catch(() => undefined)
  const reader = new ArchiveReader(unzip)
  try {
    for (;;) {
      signal.throwIfAborted()
      const header = await reader.read(512)
      if (header.every(byte => byte === 0)) {
        if ((await reader.read(512)).some(byte => byte !== 0)) throw new Error('Invalid archive end.')
        await reader.finish(); break
      }
      const name = entryName(header), size = octal(header.subarray(124, 136))
      if (files.has(name) || files.size >= 100002) throw new Error('The backup contains duplicate entries or too many files.')
      allocated += size
      if (size > 0o77777777777 || allocated > budget || (name === 'manifest.json' && size > 32 * 1024 ** 2) || (name === 'README.txt' && size > 1024 ** 2)) throw new Error('The backup exceeds the restore size limit or available disk space.')
      const destination = join(directory, name)
      await mkdir(dirname(destination), { recursive: true })
      const file = await open(destination, 'wx', 0o600), hash = createHash('sha256')
      try {
        for (let left = size; left > 0;) {
          signal.throwIfAborted()
          const bytes = await reader.read(Math.min(left, 256 * 1024))
          await file.writeFile(bytes); hash.update(bytes); left -= bytes.length; completed += bytes.length; progress(completed)
        }
        await file.sync()
      } finally { await file.close() }
      if ((await reader.read((512 - size % 512) % 512)).some(byte => byte !== 0)) throw new Error('Invalid archive padding.')
      files.set(name, { path: name, bytes: size, sha256: hash.digest('hex') })
    }
    await task
    if (!files.has('manifest.json') || !files.has('data/library.db')) throw new Error('This is not a complete HiDockNotes backup.')
    const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')) as BackupManifest
    if (manifest.format !== 'hidocknotes-library-backup' || manifest.formatVersion !== 1 || typeof manifest.appVersion !== 'string' || !Number.isFinite(Date.parse(manifest.createdAt)) || !Array.isArray(manifest.files) || !Array.isArray(manifest.recordings) || !manifest.counts || typeof manifest.counts !== 'object' || !Number.isSafeInteger(manifest.changedAudio) || manifest.changedAudio < 0) throw new Error('Unsupported backup manifest.')
    const declared = new Set<string>()
    for (const file of manifest.files) {
      const extracted = files.get(file.path)
      if (!extracted || declared.has(file.path) || ['manifest.json', 'README.txt'].includes(file.path) || file.bytes !== extracted.bytes || file.sha256 !== extracted.sha256) throw new Error('A backup file failed its SHA-256 integrity check.')
      declared.add(file.path)
    }
    if (files.size - Number(files.has('README.txt')) - 1 !== declared.size) throw new Error('The backup has files missing from its manifest.')
    return manifest
  } finally { input.destroy(); unzip.destroy(); await task.catch(() => undefined) }
}
