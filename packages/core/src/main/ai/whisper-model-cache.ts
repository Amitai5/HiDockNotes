import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { sha256File } from './model-cache'
import { ProcessingError } from './errors'

const execute = promisify(execFile)
// Pinned from the official sherpa-onnx release bytes reviewed on 2026-10-08.
// Archives contain float and int8 variants; retain only the three int8 files.
export const WHISPER_ASSETS = {
  'whisper-small': { name: 'small', size: 639387718, sha256: '486a46afbb7ba798507190ffe02fea2dd726049af212e774537efac6afb210a6', encoder: '4cbe7b22fa9026b843b60a68640c747de05bafb1a11b57edc0e66c232d9f33a9', decoder: 'acad50b5c782696e91b55914cc5ab4f756f1532f76e22aa6fc615f39fb69a8ee' },
  'whisper-base': { name: 'base', size: 207557382, sha256: '911b2083efd7c0dca2ac3b358b75222660dc09fb716d64fbfc417ba6c99ff3de', encoder: '0b8fb1304b6109976038efff5ace81720e00386f3ff6b54ee8c75291ca0a1e11', decoder: '9759d217388a01b3a4c7c15533201067b48ae819c4daafc8624e64b9409dc02d' }
} as const
const TOKENS_HASH = 'b34b360dbb493e781e479794586d661700670d65564001f23024971d1f2fa126'
export type WhisperModelId = keyof typeof WHISPER_ASSETS
export interface WhisperModelFiles { encoder: string; decoder: string; tokens: string }
export function whisperModelId(value: string): WhisperModelId { if (value !== 'whisper-small' && value !== 'whisper-base') throw new ProcessingError('Choose a supported local Whisper model in Settings.'); return value }
export function validateWhisperArchive(entries: string[], root: string): void {
  if (!entries.length || entries.length > 100 || entries.some(entry => !entry.startsWith(root + '/') || entry.includes('\\') || entry.split('/').includes('..'))) throw new ProcessingError('The local transcription model archive contains an unexpected path.')
}
async function valid(path: string, hash: string): Promise<boolean> { try { return await sha256File(path) === hash } catch { return false } }

/** Translate local setup failures without persisting URLs, credentials or subprocess output. */
export function whisperPreparationError(error: unknown): ProcessingError {
  if (error instanceof ProcessingError) return error
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  if (['EACCES', 'EPERM', 'EROFS'].includes(code)) return new ProcessingError('The app cannot write its local Whisper models. Give the app user write access to the model dataset and retry.')
  if (['ENOSPC', 'EDQUOT'].includes(code)) return new ProcessingError('There is not enough disk space for the local Whisper model. Free space on the model dataset and retry.')
  if (code === 'ENOENT' || error && typeof error === 'object' && 'stderr' in error && String(error.stderr).includes('bzip2')) return new ProcessingError('The local Whisper archive tool is unavailable. Update the server image, or install the system tar/bzip2 tools, then retry.')
  return new ProcessingError('The local Whisper model could not be prepared. Check the server connection to GitHub and available model storage, then retry.', true)
}

export class WhisperModelCache {
  constructor(private readonly folder: string, private readonly request: typeof fetch = fetch) {}
  async ensure(model: WhisperModelId, progress: (message: string) => void, signal?: AbortSignal): Promise<WhisperModelFiles> {
    const asset = WHISPER_ASSETS[model], destination = join(this.folder, model)
    const files = { encoder: join(destination, 'encoder.int8.onnx'), decoder: join(destination, 'decoder.int8.onnx'), tokens: join(destination, 'tokens.txt') }
    signal?.throwIfAborted()
    if (await valid(files.encoder, asset.encoder) && await valid(files.decoder, asset.decoder) && await valid(files.tokens, TOKENS_HASH)) return files
    try {
    await mkdir(destination, { recursive: true })
    const staging = join(destination, 'download-' + randomUUID()), archive = join(staging, 'model.tar.bz2'), root = 'sherpa-onnx-whisper-' + asset.name
    await mkdir(staging)
    try {
      progress(`Downloading Whisper ${asset.name === 'small' ? 'Small' : 'Base'} for local transcription…`)
      const response = await this.request(`https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${root}.tar.bz2`, { signal: AbortSignal.any([AbortSignal.timeout(1800000), ...(signal ? [signal] : [])]) })
      if (!response.ok || !response.body) throw new ProcessingError('The local Whisper model could not be downloaded from the official release. Check your connection and retry.', true)
      let bytes = 0, lastProgress = 0
      const hash = createHash('sha256')
      const verifier = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length
        if (bytes > asset.size) { callback(new ProcessingError('The local Whisper download exceeded its expected size.')); return }
        hash.update(chunk)
        if (Date.now() - lastProgress > 500) { progress(`Downloading local Whisper: ${Math.floor(bytes / asset.size * 100)}% (${Math.round(bytes / 1000000)} / ${Math.round(asset.size / 1000000)} MB)…`); lastProgress = Date.now() }
        callback(null, chunk)
      } })
      await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), verifier, createWriteStream(archive), { signal })
      if (bytes !== asset.size || hash.digest('hex') !== asset.sha256) throw new ProcessingError('The local Whisper model download failed verification. Retry to obtain a complete copy.', true)
      progress('Verifying and preparing the local Whisper model…')
      const tar = process.platform === 'win32' ? 'tar.exe' : '/usr/bin/tar'
      const contents = await execute(tar, ['-tf', archive], { windowsHide: true, signal, maxBuffer: 100000 })
      validateWhisperArchive(contents.stdout.trim().split(/\r?\n/), root)
      const members = [`${root}/${asset.name}-encoder.int8.onnx`, `${root}/${asset.name}-decoder.int8.onnx`, `${root}/${asset.name}-tokens.txt`]
      await execute(tar, ['-xjf', archive, '-C', staging, ...members], { windowsHide: true, signal })
      const extracted = members.map(member => join(staging, member))
      for (let index = 0; index < extracted.length; index++) if (!await valid(extracted[index], [asset.encoder, asset.decoder, TOKENS_HASH][index])) throw new ProcessingError('An extracted Whisper model failed verification. Retry the download.', true)
      // A verified archive cannot introduce arbitrary files into the cache.
      await rename(extracted[0], files.encoder); await rename(extracted[1], files.decoder); await rename(extracted[2], files.tokens)
      if (!(await readFile(files.tokens, 'utf8')).trim()) throw new ProcessingError('The local Whisper vocabulary is empty.')
      return files
    } finally { if (resolve(staging).startsWith(resolve(destination) + sep)) await rm(staging, { recursive: true, force: true }) }
    } catch (error) { if (signal?.aborted) throw error; throw whisperPreparationError(error) }
  }
}
