import { createHash } from 'node:crypto'
import { open, realpath, stat } from 'node:fs/promises'

/** Standard ustar files only, with portable short names and no executable bits. */
export function tarHeader(name: string, size: number): Buffer {
  if (!/^[a-zA-Z0-9_./-]+$/.test(name) || name.startsWith('/') || name.split('/').some(part => !part || part === '..' || part === '.') || Buffer.byteLength(name) > 99) throw new Error('Invalid backup archive entry.')
  if (!Number.isSafeInteger(size) || size < 0 || size > 0o77777777777) throw new Error('An individual backup file exceeds the portable archive limit (8 GB).')
  const header = Buffer.alloc(512)
  header.write(name, 0); header.write('0000600\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116)
  header.write(size.toString(8).padStart(11, '0') + '\0', 124)
  header.write('00000000000\0', 136); header.fill(32, 148, 156); header.write('0', 156)
  header.write('ustar\0', 257); header.write('00', 263)
  const checksum = header.reduce((sum, byte) => sum + byte, 0)
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148)
  return header
}
export async function* tarBuffer(name: string, content: Buffer): AsyncGenerator<Buffer> {
  yield tarHeader(name, content.length); yield content
  const padding = (512 - content.length % 512) % 512
  if (padding) yield Buffer.alloc(padding)
}
export interface ArchivedFile { path: string; bytes: number; sha256: string }
/** Checks the same open file handle before and after streaming, including its pathname. */
export async function* tarFile(source: string, name: string, files: ArchivedFile[], signal: AbortSignal, progress: (bytes: number) => void): AsyncGenerator<Buffer> {
  signal.throwIfAborted()
  const resolved = await realpath(source)
  const file = await open(resolved, 'r')
  try {
    const before = await file.stat()
    if (!before.isFile()) throw new Error('A saved recording is not a regular file.')
    yield tarHeader(name, before.size)
    const hash = createHash('sha256'), buffer = Buffer.alloc(256 * 1024)
    let position = 0
    while (position < before.size) {
      signal.throwIfAborted()
      const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, before.size - position), position)
      if (!bytesRead) throw new Error('A saved file changed while it was being backed up. Try again.')
      const bytes = Buffer.from(buffer.subarray(0, bytesRead))
      hash.update(bytes); position += bytesRead; progress(bytesRead); yield bytes
    }
    const after = await file.stat()
    const current = await stat(resolved)
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || current.ino !== before.ino || current.dev !== before.dev || await realpath(source) !== resolved) throw new Error('A saved file changed while it was being backed up. Try again.')
    files.push({ path: name, bytes: position, sha256: hash.digest('hex') })
    const padding = (512 - position % 512) % 512
    if (padding) yield Buffer.alloc(padding)
  } finally { await file.close() }
}
