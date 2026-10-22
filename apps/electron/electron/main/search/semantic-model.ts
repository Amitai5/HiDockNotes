import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { sha256File } from '../ai/model-cache'

export const SEARCH_MODEL_REVISION = '751bff37182d3f1213fa05d7196b954e230abad9'
export const SEARCH_MODEL_ID = `minilm-l6-v2-q8:${SEARCH_MODEL_REVISION}:v1`
// Reviewed immutable publisher files; inference has remote loading disabled.
export const SEARCH_MODEL_FILES = [
  { name: 'config.json', bytes: 650, sha256: '7135149f7cffa1a573466c6e4d8423ed73b62fd2332c575bf738a0d033f70df7' },
  { name: 'tokenizer.json', bytes: 711661, sha256: 'da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0' },
  { name: 'tokenizer_config.json', bytes: 366, sha256: '9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3' },
  { name: 'special_tokens_map.json', bytes: 125, sha256: 'b6d346be366a7d1d48332dbc9fdf3bf8960b5d879522b7799ddba59e76237ee3' },
  { name: 'onnx/model_quantized.onnx', bytes: 22972370, sha256: 'afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1' }
] as const
export function searchModelDirectory(dataPath: string): string { return join(dataPath, 'models', 'semantic-minilm-v1') }
export async function hasSearchModel(directory: string): Promise<boolean> {
  for (const file of SEARCH_MODEL_FILES) {
    try { if ((await stat(join(directory, file.name))).size !== file.bytes || await sha256File(join(directory, file.name)) !== file.sha256) return false } catch { return false }
  }
  return true
}
/** Downloads only reviewed model bytes, publishing each file after its length and digest match. */
export async function downloadSearchModel(directory: string, progress: (value: number) => void, signal: AbortSignal, request: typeof fetch = fetch): Promise<void> {
  await mkdir(join(directory, 'onnx'), { recursive: true })
  const total = SEARCH_MODEL_FILES.reduce((sum, file) => sum + file.bytes, 0)
  let completed = 0
  for (const file of SEARCH_MODEL_FILES) {
    signal.throwIfAborted()
    const target = join(directory, file.name)
    const valid = await sha256File(target).then(hash => hash === file.sha256).catch(() => false)
    if (valid) { completed += file.bytes; progress(completed / total); continue }
    const staged = target + '.' + randomUUID() + '.partial'
    try {
      const response = await request(`https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/${SEARCH_MODEL_REVISION}/${file.name}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(300000)]) })
      if (!response.ok || !response.body) throw new Error('The search model could not be downloaded. Check your connection and retry.')
      const hash = createHash('sha256')
      let bytes = 0, lastProgress = 0
      const verifier = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length
        if (bytes > file.bytes) { callback(new Error('The search model download exceeded its expected size.')); return }
        hash.update(chunk)
        if (Date.now() - lastProgress > 200) { progress((completed + bytes) / total); lastProgress = Date.now() }
        callback(null, chunk)
      } })
      await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), verifier, createWriteStream(staged, { flags: 'wx', mode: 0o600 }), { signal })
      if (bytes !== file.bytes || hash.digest('hex') !== file.sha256) throw new Error('The search model failed verification. Retry to download a clean copy.')
      await rename(staged, target); completed += bytes; progress(completed / total)
    } finally { await rm(staged, { force: true }) }
  }
}
