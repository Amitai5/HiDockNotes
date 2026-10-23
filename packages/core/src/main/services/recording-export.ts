import { constants } from 'node:fs'
import { copyFile, mkdtemp, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { RecordingDetail } from '../../../src/shared/contracts'
import { DEFAULT_EXPORT_OPTIONS, isSubtitleFormat, type RecordingExportOptions } from '../../../src/shared/export'
import { queryOne, type Recording } from './database'
import { hashFile } from './file-verification'
import { preparePlayback } from './audio-playback'
import { exportTranscript } from './transcript-export'

export function validateExportOptions(value: unknown): RecordingExportOptions {
  if (value === undefined) return { ...DEFAULT_EXPORT_OPTIONS }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid export options.')
  const input = value as Record<string, unknown>
  if (Object.keys(input).some(key => !['content', 'format', 'includeAudio'].includes(key)) || typeof input.content !== 'string' || !['summary', 'summary-transcript'].includes(input.content) || typeof input.format !== 'string' || !['md', 'txt', 'srt', 'vtt'].includes(input.format) || typeof input.includeAudio !== 'boolean') throw new Error('Choose valid export content, format, and audio options.')
  const options = input as unknown as RecordingExportOptions
  if (options.content === 'summary' && isSubtitleFormat(options.format)) throw new Error('Subtitle formats require the transcript. Choose Markdown or text for a summary.')
  return { content: options.content, format: options.format, includeAudio: options.includeAudio }
}
export function exportFilename(title: string): string {
  let name = title.replace(/[\u0000-\u001f<>:"/\\|?*]/g, '-').replace(/[. ]+$/, '').trim().slice(0, 100).replace(/[. ]+$/, '')
  if (!name) name = 'Recording'
  if (/^(CON|PRN|AUX|NUL|COM\d|LPT\d)(\.|$)/i.test(name)) name = '_' + name
  return name
}
export async function exportNotesFile(detail: RecordingDetail, filePath: string, options: RecordingExportOptions): Promise<void> {
  const staged = filePath + '.' + randomUUID() + '.partial'
  try {
    await writeFile(staged, exportTranscript(detail, options.format, options.content), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    await rename(staged, filePath)
  } finally { await unlink(staged).catch(() => undefined) }
}
export async function exportNotesWithAudio(detail: RecordingDetail, parentFolder: string, options: RecordingExportOptions): Promise<string> {
  const recording = queryOne<Recording>('SELECT * FROM recordings WHERE id=?', [detail.recording.id])
  if (!recording?.file_path || !recording.verified || !recording.checksum) throw new Error('Download and verify this recording before including audio.')
  const before = await stat(recording.file_path)
  if (!before.isFile() || before.size !== recording.file_size || await hashFile(recording.file_path) !== recording.checksum) throw new Error('The saved audio changed after verification. Import or download a clean copy before exporting audio.')
  const playable = await preparePlayback(recording.id)
  const after = await stat(recording.file_path)
  if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error('The audio changed during export. Try again after the recording is saved.')
  const name = exportFilename(detail.recording.title || basename(detail.recording.filename))
  // A new, uniquely owned directory prevents overwriting the original or an
  // earlier export. Large audio copies stay asynchronous in the main process.
  const folder = await mkdtemp(join(parentFolder, name + '-'))
  try {
    const audio = join(folder, name + '.wav')
    await copyFile(playable, audio, constants.COPYFILE_EXCL)
    if (await hashFile(audio) !== await hashFile(playable)) throw new Error('The exported audio failed verification. Try another destination.')
    await exportNotesFile(detail, join(folder, name + '.' + options.format), options)
    return folder
  } catch (error) {
    // This path is returned directly by mkdtemp, never supplied by the renderer.
    try { await rm(folder, { recursive: true, force: true }) } catch { throw new Error('Export failed and its incomplete export folder could not be removed. Check the destination folder.', { cause: error }) }
    throw error
  }
}
