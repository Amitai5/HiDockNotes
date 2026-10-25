import { request, response } from './http'
import { hashBlob } from './hash'
export interface UploadMetadata { filename: string; serial?: string; deviceFilename?: string; recordedAt?: string; projectId?: string | null; requestId?: string }
export async function uploadAudio(blob: Blob, metadata: UploadMetadata, progress: (offset: number) => void = () => undefined, signal?: AbortSignal, verifying: () => void = () => undefined): Promise<string> {
  signal?.throwIfAborted()
  const checksum = await hashBlob(blob, signal)
  let upload = await request<{ id: string; offset: number; recording_id: string }>('/api/v1/uploads', { ...metadata, requestId: metadata.requestId??crypto.randomUUID(), size: blob.size, checksum })
  while (upload.offset < blob.size) { signal?.throwIfAborted(); upload = await (await response('/api/v1/uploads/' + upload.id + '?offset=' + upload.offset, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: blob.slice(upload.offset, upload.offset + 1024 * 1024), signal })).json(); progress(upload.offset) }
  signal?.throwIfAborted(); verifying()
  const done = await request<{ recording_id: string }>('/api/v1/uploads/' + upload.id + '/complete', {}); return done.recording_id
}
export async function chooseFiles(accept: string, multiple = false): Promise<File[]> { return new Promise(resolve => { const input = document.createElement('input'); input.type = 'file'; input.accept = accept; input.multiple = multiple; input.onchange = () => resolve([...input.files ?? []]); input.oncancel = () => resolve([]); input.click() }) }
