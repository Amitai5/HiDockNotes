import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, readFile, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ProcessingError } from './errors'

const execute = promisify(execFile)
// SHA-256 values pinned from these official release assets on 2026-10-07.
// The older release assets have no GitHub digest field; hashes are pinned here
// so later downloads and cached files are checked against the reviewed bytes.
export const MODEL_ASSETS = {
  speech: {
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx',
    sha256: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6',
    size: 643854
  },
  segmentation: {
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2',
    sha256: '24615ee884c897d9d2ba09bb4d30da6bb1b15e685065962db5b02e76e4996488',
    modelSha256: '220ad67ca923bef2fa91f2390c786097bf305bceb5e261d4af67b38e938e1079',
    size: 6958444
  },
  embedding: {
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx',
    sha256: '1a331345f04805badbb495c775a6ddffcdd1a732567d5ec8b3d5749e3c7a5e4b',
    size: 39593761
  }
} as const
export interface DiarizationModels { segmentation: string; embedding: string }
export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
export function verifyDigest(actual: string, expected: string): void {
  if (actual !== expected) throw new ProcessingError('The downloaded voice model failed its checksum. Retry to download a clean copy.', true)
}
async function valid(path: string, hash: string): Promise<boolean> { try { return await sha256File(path) === hash } catch { return false } }
export class ModelCache {
  constructor(private readonly folder: string, private readonly request: typeof fetch = fetch) {}
  async ensureSpeech(progress: (message: string) => void, signal?: AbortSignal): Promise<string> {
    await mkdir(this.folder, { recursive: true })
    const model = join(this.folder, 'silero_vad.onnx')
    if (!await valid(model, MODEL_ASSETS.speech.sha256)) await this.download(MODEL_ASSETS.speech, model, () => progress('Downloading the local speech detector…'), signal)
    return model
  }
  async ensure(progress: (message: string, fraction: number) => void, signal?: AbortSignal): Promise<DiarizationModels> {
    await mkdir(this.folder, { recursive: true })
    const segmentation = join(this.folder, 'pyannote-segmentation-3.0.onnx')
    const embedding = join(this.folder, '3dspeaker-eres2net.onnx')
    if (!await valid(segmentation, MODEL_ASSETS.segmentation.modelSha256)) {
      const archive = join(this.folder, 'segmentation-' + randomUUID() + '.tar.bz2')
      await this.download(MODEL_ASSETS.segmentation, archive, p => progress('Downloading speaker segmentation model…', p * 0.15), signal)
      const staging = join(this.folder, 'extract-' + randomUUID())
      await mkdir(staging)
      try {
        const contents = await execute(process.platform === 'win32' ? 'tar.exe' : '/usr/bin/tar', ['-tf', archive], { windowsHide: true, signal, maxBuffer: 100000 })
        const entries = contents.stdout.trim().split(/\r?\n/)
        if (entries.length > 100 || entries.some(p => !p.startsWith('sherpa-onnx-pyannote-segmentation-3-0/') || p.split(/[\\/]/).includes('..'))) throw new ProcessingError('The voice model archive contains an unexpected path.')
        await execute(process.platform === 'win32' ? 'tar.exe' : '/usr/bin/tar', ['-xjf', archive, '-C', staging, 'sherpa-onnx-pyannote-segmentation-3-0/model.onnx', 'sherpa-onnx-pyannote-segmentation-3-0/LICENSE'], { windowsHide: true, signal })
        const extracted = join(staging, 'sherpa-onnx-pyannote-segmentation-3-0')
        verifyDigest(await sha256File(join(extracted, 'model.onnx')), MODEL_ASSETS.segmentation.modelSha256)
        await writeFile(join(this.folder, 'pyannote-LICENSE.txt'), await readFile(join(extracted, 'LICENSE')))
        await rename(join(extracted, 'model.onnx'), segmentation)
      } finally {
        if (resolve(staging).startsWith(resolve(this.folder) + sep)) await rm(staging, { recursive: true, force: true })
        await rm(archive, { force: true })
      }
    }
    if (!await valid(embedding, MODEL_ASSETS.embedding.sha256)) await this.download(MODEL_ASSETS.embedding, embedding, p => progress('Downloading speaker recognition model…', 0.15 + p * 0.85), signal)
    progress('Voice models are ready.', 1)
    return { segmentation, embedding }
  }
  private async download(asset: { url: string; sha256: string; size: number }, destination: string, progress: (fraction: number) => void, signal?: AbortSignal): Promise<void> {
    const staged = destination + '.' + randomUUID() + '.partial'
    try {
      const response = await this.request(asset.url, { signal: AbortSignal.any([AbortSignal.timeout(300000), ...(signal ? [signal] : [])]) })
      if (!response.ok || !response.body) throw new ProcessingError('The voice models could not be downloaded from the official release. Check your connection and retry.', true)
      let bytes = 0
      const hash = createHash('sha256')
      let lastProgress = 0
      const verifier = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length
        if (bytes > asset.size) { callback(new ProcessingError('The voice model download exceeded its expected size.')); return }
        hash.update(chunk)
        if (Date.now() - lastProgress > 300) { progress(bytes / asset.size); lastProgress = Date.now() }
        callback(null, chunk)
      } })
      await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), verifier, createWriteStream(staged), { signal })
      if (bytes !== asset.size) throw new ProcessingError('The voice model download was incomplete. Retry to resume setup.', true)
      verifyDigest(hash.digest('hex'), asset.sha256)
      await rename(staged, destination)
    } catch (error) { if (error instanceof ProcessingError) throw error; throw new ProcessingError('The local voice models could not be prepared. Check your connection, disk space and system archive tool, then retry.', true) }
    finally { await rm(staged, { force: true }) }
  }
}
