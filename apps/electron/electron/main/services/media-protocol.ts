import { protocol } from 'electron'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { preparePlayback } from './audio-playback'
import { validateId } from '../ipc/jensen-validation'

export function parseRange(value: string | null, size: number): { start: number; end: number; partial: boolean } {
  if (!value) return { start: 0, end: size - 1, partial: false }
  const match = /^bytes=(\d*)-(\d*)$/.exec(value)
  if (!match || (!match[1] && !match[2])) throw new Error('Invalid byte range.')
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]))
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size || start < 0) throw new Error('Unsatisfiable byte range.')
  return { start, end, partial: true }
}
export function registerMediaProtocol(): void {
  protocol.handle('app-media', async request => {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 })
      const url = new URL(request.url)
      if (url.hostname !== 'recording' || url.search || url.hash) return new Response(null, { status: 400 })
      const wav = await preparePlayback(validateId(url.pathname.slice(1)))
      const size = (await stat(wav)).size
      let range: ReturnType<typeof parseRange>
      try { range = parseRange(request.headers.get('range'), size) } catch { return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } }) }
      const headers: Record<string, string> = { 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes', 'Content-Length': String(range.end - range.start + 1), 'Cache-Control': 'private, max-age=0' }
      if (range.partial) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`
      const body = request.method === 'HEAD' ? null : Readable.toWeb(createReadStream(wav, { start: range.start, end: range.end })) as ReadableStream<Uint8Array>
      return new Response(body, { status: range.partial ? 206 : 200, headers })
    } catch { return new Response('Audio is unavailable. See the activity log for conversion errors.', { status: 404 }) }
  })
}
