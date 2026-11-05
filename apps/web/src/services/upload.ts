import { HttpError, response } from './http'
import { hashBlob } from './hash'

export interface UploadMetadata { filename: string; serial?: string; deviceFilename?: string; recordedAt?: string; projectId?: string | null; requestId?: string }
interface Upload { id: string; offset: number; recording_id: string | null }
const CHUNK_SIZE = 4 * 1024 * 1024
const RETRIES = 3

function retryable(error: unknown): boolean {
  return error instanceof TypeError || error instanceof HttpError && ([408, 409, 425, 429].includes(error.status) || error.status >= 500)
}

async function waitToRetry(attempt: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal?.reason) }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, 400 * 2 ** attempt)
    signal?.addEventListener('abort', abort, { once: true })
  })
}

async function withRetry<T>(action: (attempt: number) => Promise<T>, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted()
    try { return await action(attempt) }
    catch (error) {
      signal?.throwIfAborted()
      if (attempt >= RETRIES || !retryable(error)) throw error
      await waitToRetry(attempt, signal)
    }
  }
}

async function uploadJson<T>(path: string, signal?: AbortSignal, body?: unknown): Promise<T> {
  return (await response(path, { signal, ...(body !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })).json()
}

function validateOffset(upload: Upload, size: number, id?: string): void {
  if (!upload || typeof upload.id !== 'string' || id && upload.id !== id || !Number.isSafeInteger(upload.offset) || upload.offset < 0 || upload.offset > size) throw new Error('The server returned an invalid upload position. Retry this recording.')
}

export async function uploadAudio(blob: Blob, metadata: UploadMetadata, progress: (offset: number) => void = () => undefined, signal?: AbortSignal, verifying: () => void = () => undefined): Promise<string> {
  signal?.throwIfAborted()
  const checksum = await hashBlob(blob, signal)
  const identity = { ...metadata, requestId: metadata.requestId ?? crypto.randomUUID(), size: blob.size, checksum }
  let upload = await withRetry(() => uploadJson<Upload>('/api/v1/uploads', signal, identity), signal)
  validateOffset(upload, blob.size)
  progress(upload.offset)
  let chunkSize = CHUNK_SIZE
  while (upload.offset < blob.size) {
    const id = upload.id, path = '/api/v1/uploads/' + encodeURIComponent(id)
    upload = await withRetry(async attempt => {
      // A failed response may still have committed its chunk. Read the durable
      // server offset before retrying so acknowledged bytes are never duplicated.
      const current = attempt ? await uploadJson<Upload>(path, signal) : upload
      validateOffset(current, blob.size, id)
      if (current.offset === blob.size) return current
      let end = Math.min(current.offset + chunkSize, blob.size)
      const send = () => response(path + '?offset=' + current.offset, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: blob.slice(current.offset, end), signal })
      let result: Response
      try { result = await send() }
      catch (error) {
        // A cached frontend may briefly meet an older server during rollback.
        if (!(error instanceof HttpError) || error.status !== 413 || chunkSize <= 1024 * 1024) throw error
        chunkSize = 1024 * 1024
        end = Math.min(current.offset + chunkSize, blob.size)
        result = await send()
      }
      const next: Upload = await result.json()
      validateOffset(next, blob.size, id)
      if (next.offset !== end) throw new Error('The server did not confirm this audio chunk. Retry this recording.')
      return next
    }, signal)
    progress(upload.offset)
  }
  signal?.throwIfAborted()
  verifying()
  const done = await withRetry(() => uploadJson<{ recording_id: string }>('/api/v1/uploads/' + encodeURIComponent(upload.id) + '/complete', signal, {}), signal)
  if (!done?.recording_id) throw new Error('The server could not verify this recording. Retry the upload.')
  return done.recording_id
}

export async function chooseFiles(accept: string, multiple = false): Promise<File[]> { return new Promise(resolve => { const input = document.createElement('input'); input.type = 'file'; input.accept = accept; input.multiple = multiple; input.onchange = () => resolve([...input.files ?? []]); input.oncancel = () => resolve([]); input.click() }) }
