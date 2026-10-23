import { createHash } from 'node:crypto'
import type { TranscriptSegment } from '../../../src/shared/contracts'
import type { TimedText } from './providers'

export interface SpeakerTurn { start: number; end: number; speaker: number }
export interface ChunkPlan { start: number; end: number; keepStart: number; keepEnd: number }
export function planChunks(duration: number, maximum = 180, overlap = 1): ChunkPlan[] {
  if (!Number.isFinite(duration) || duration <= 0 || maximum < 10 || overlap < 0 || overlap >= maximum / 2) throw new Error('Invalid audio chunk duration.')
  const result: ChunkPlan[] = []
  for (let start = 0; start < duration; start += maximum) result.push({ start: Math.max(0, start - overlap), end: Math.min(duration, start + maximum + overlap), keepStart: start, keepEnd: Math.min(duration, start + maximum) })
  return result
}
export function stitchChunk(items: TimedText[], chunk: ChunkPlan): TimedText[] {
  return items.map(item => ({ ...item, start: item.start + chunk.start, end: item.end + chunk.start })).filter(item => {
    const center = (item.start + item.end) / 2
    return center >= chunk.keepStart && (center < chunk.keepEnd || center === chunk.keepEnd && chunk.end === chunk.keepEnd)
  })
}
export function deterministicId(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex').slice(0, 32)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
export function speakerForTime(item: TimedText, turns: SpeakerTurn[]): number | null {
  let best = 0, speaker: number | null = null
  for (const turn of turns) {
    const overlap = Math.max(0, Math.min(item.end, turn.end) - Math.max(item.start, turn.start))
    if (overlap > best || item.start === item.end && item.start >= turn.start && item.start <= turn.end) { best = overlap; speaker = turn.speaker }
  }
  return speaker
}
export function alignTranscript(recordingId: string, items: TimedText[], turns: SpeakerTurn[], names: Map<number, string>, words: boolean): TranscriptSegment[] {
  const output: TranscriptSegment[] = []
  for (const item of [...items].sort((a, b) => a.start - b.start)) {
    const speaker = speakerForTime(item, turns)
    const speakerId = speaker === null ? null : deterministicId(`${recordingId}:speaker:${speaker}`)
    const previous = output[output.length - 1]
    if (previous && item.text === previous.text && Math.abs(item.start - previous.start) < 0.35) continue
    if (words && previous && previous.speakerId === speakerId && item.start - previous.end < 1.5 && item.end - previous.start <= 12 && !/[.!?。！？]$/.test(previous.text)) {
      previous.text += /^[,.;:!?，。]/.test(item.text) ? item.text : ' ' + item.text
      previous.end = Math.max(previous.end, item.end)
    } else output.push({ id: deterministicId(`${recordingId}:segment:${output.length}`), start: item.start, end: item.end, text: item.text, speakerId, speakerName: speaker === null ? 'Unassigned speaker' : names.get(speaker) ?? `Speaker ${speaker + 1}` })
  }
  return output
}
