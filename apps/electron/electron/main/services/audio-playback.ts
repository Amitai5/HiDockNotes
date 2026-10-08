import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, open, rename, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import ffmpegPath from 'ffmpeg-static'
import { queryOne, type Recording } from './database'
import { getDataPath } from './config'
import { hasConfirmedMpegHeader } from './audio-duration'

const preparing = new Map<string, Promise<string>>()
export async function preparePlayback(id: string): Promise<string> {
  const recording = queryOne<Recording>('SELECT * FROM recordings WHERE id=?', [id])
  if (!recording?.file_path) throw new Error('This recording has not been downloaded.')
  const source = await stat(recording.file_path)
  const key = `${id}-${source.size}-${Math.trunc(source.mtimeMs)}`
  if (preparing.has(key)) return preparing.get(key)!
  const task = convertAudioFile(recording.file_path, key, join(getDataPath(), 'cache', 'playback'))
  preparing.set(key, task)
  try { return await task } finally { preparing.delete(key) }
}
export async function convertAudioFile(source: string, key: string, folder: string, signal?: AbortSignal): Promise<string> {
  await mkdir(folder, { recursive: true })
  const output = join(folder, key + '.wav')
  try { if ((await stat(output)).size > 44) return output } catch { /* first playback */ }
  if (!ffmpegPath) throw new Error('Bundled audio converter is missing.')
  const executable = ffmpegPath.replace('app.asar', 'app.asar.unpacked')
  const head = await open(source, 'r')
  const buffer = Buffer.alloc(65536)
  let bytesRead: number
  try { bytesRead = (await head.read(buffer, 0, buffer.length, 0)).bytesRead } finally { await head.close() }
  let payload = 0
  if (buffer.toString('ascii', 0, 4) === 'RIFF') {
    for (let offset = 12; offset + 8 <= bytesRead;) {
      const length = buffer.readUInt32LE(offset + 4)
      if (buffer.toString('ascii', offset, offset + 4) === 'data') { payload = offset + 8; break }
      offset += 8 + length + (length % 2)
    }
  }
  const disguisedMpeg = payload > 0 && hasConfirmedMpegHeader(buffer.subarray(0, bytesRead), payload)
  const extracted = join(folder, key + '.mp3.partial')
  if (disguisedMpeg) await pipeline(createReadStream(source, { start: payload }), createWriteStream(extracted))
  const staged = output + '.partial'
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(executable, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', ...(disguisedMpeg ? ['-f', 'mp3'] : []), '-i', disguisedMpeg ? extracted : source, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-f', 'wav', staged], { windowsHide: true, signal })
      let failure = ''
      child.stderr.on('data', data => { failure = (failure + String(data)).slice(-1500) })
      child.on('error', reject)
      child.on('close', code => code === 0 ? resolve() : reject(new Error(failure.trim() || 'Audio conversion failed.')))
    })
    await rename(staged, output)
    return output
  } finally { await unlink(extracted).catch(() => undefined); await unlink(staged).catch(() => undefined) }
}
export async function readWaveform(id: string): Promise<{ peaks: number[]; duration: number }> {
  const wav = await preparePlayback(id)
  const handle = await open(wav, 'r')
  const buffer = Buffer.alloc(1024)
  let dataOffset = 44
  try {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    for (let offset = 12; offset + 8 <= bytesRead;) {
      if (buffer.toString('ascii', offset, offset + 4) === 'data') { dataOffset = offset + 8; break }
      const length = buffer.readUInt32LE(offset + 4); offset += 8 + length + (length % 2)
    }
  } finally { await handle.close() }
  const samples = Math.floor(((await stat(wav)).size - dataOffset) / 2)
  const peaks = new Array<number>(180).fill(0)
  let position = 0
  for await (const chunk of createReadStream(wav, { start: dataOffset })) {
    const bytes = chunk as Buffer
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      const bucket = Math.min(179, Math.floor(position++ * 180 / samples))
      peaks[bucket] = Math.max(peaks[bucket], Math.abs(bytes.readInt16LE(i)) / 32768)
    }
  }
  return { peaks, duration: samples / 16000 }
}
