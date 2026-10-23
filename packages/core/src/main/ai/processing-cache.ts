import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { ProcessingError } from './errors'
import type { TimedText, TranscriptionResult } from './providers'

export async function readProcessingCache(path: string): Promise<unknown> {
  try { return JSON.parse(await readFile(path, 'utf8')) as unknown }
  catch (error) {
    if (error instanceof SyntaxError || (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) return null
    throw new ProcessingError('The local processing cache could not be read. Check folder permissions and retry.')
  }
}

export async function writeProcessingCache(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const staged = path + '.' + randomUUID() + '.partial'
  try {
    await writeFile(staged, JSON.stringify(value), { mode: 0o600 })
    await rename(staged, path)
  } finally { await rm(staged, { force: true }) }
}

export function isTimedText(value: unknown, duration: number): value is TimedText {
  if (!value || typeof value !== 'object') return false
  const item = value as TimedText
  return Number.isFinite(item.start) && Number.isFinite(item.end) && item.start >= 0 && item.end >= item.start && item.end <= duration && typeof item.text === 'string' && !!item.text.trim()
}

export function isTranscriptionResult(value: unknown, duration: number): value is TranscriptionResult {
  if (!value || typeof value !== 'object') return false
  const item = value as TranscriptionResult
  return typeof item.text === 'string' && Array.isArray(item.words) && Array.isArray(item.segments) && item.words.every(word => isTimedText(word, duration)) && item.segments.every(segment => isTimedText(segment, duration))
}
