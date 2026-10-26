import { ProcessingError } from './errors'
import type { SummaryResult, TimedText, TranscriptionResult } from './providers'
import { isDateOnly } from '../../../src/shared/actionables'
import type { TranscriptSegment } from '../../../src/shared/contracts'
import { groundedName, parseMeetingParticipants, renderSummaryActions } from './summary-metadata'
import { parseSummaryOutcomes, renderSummaryOutcomes } from './summary-outcomes'

function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function timed(start: unknown, end: unknown, text: unknown, duration: number): TimedText | null {
  if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start > duration + 1 || typeof text !== 'string' || !text.trim()) return null
  return { start: Math.min(start, duration), end: Math.min(end, duration), text: text.trim() }
}
export function parseOpenAITranscript(value: unknown, duration: number): TranscriptionResult {
  const response = record(value)
  const segments = Array.isArray(response.segments) ? response.segments.map(s => { const item = record(s); return timed(item.start, item.end, item.text, duration) }).filter((s): s is TimedText => !!s) : []
  const words = Array.isArray(response.words) ? response.words.map(w => { const item = record(w); return timed(item.start, item.end, item.word, duration) }).filter((s): s is TimedText => !!s) : []
  if (!words.length && !segments.length) throw new ProcessingError('The provider returned no timestamped speech. Check the audio, language and transcription model.')
  return { text: typeof response.text === 'string' ? response.text : segments.map(s => s.text).join(' '), words, segments }
}
export function durationOffset(value: unknown): number {
  if (typeof value !== 'string' || !/^\d+(\.\d+)?s$/.test(value)) return NaN
  return Number(value.slice(0, -1))
}
export function parseGeminiTranscript(value: unknown, duration: number): TranscriptionResult {
  const words: TimedText[] = []
  // Interaction step content carries word_info annotations. Traverse the returned
  // data structure, rather than assuming one particular step contains all words.
  let visited = 0
  function visit(node: unknown, depth: number): void {
    if (++visited > 500000 || depth > 25) throw new ProcessingError('The transcription response was too complex to read safely.')
    if (Array.isArray(node)) { for (const child of node) visit(child, depth + 1); return }
    if (!node || typeof node !== 'object') return
    const item = record(node)
    if (item.type === 'word_info') {
      const word = timed(durationOffset(item.start_offset), durationOffset(item.end_offset), item.text, duration)
      if (word) words.push(word)
      return
    }
    for (const child of Object.values(item)) if (child && typeof child === 'object') visit(child, depth + 1)
  }
  visit(record(value).steps, 0)
  const unique = words.sort((a, b) => a.start - b.start).filter((w, i, all) => i === 0 || w.start !== all[i - 1].start || w.end !== all[i - 1].end || w.text !== all[i - 1].text)
  if (!unique.length) throw new ProcessingError('Gemini returned no word timestamps. Choose Gemini 3.5 Transcribe and retry.')
  return { text: unique.map(w => w.text).join(' '), words: unique, segments: [] }
}
function conciseRecordingTitle(value: string): string {
  const title = value.trim().split(/\s+/u).slice(0, 6).join(' ')
  if (Array.from(title).length <= 60) return title
  const prefix = Array.from(title).slice(0, 60).join('')
  return prefix.replace(/\s+\S*$/u, '') || prefix
}
export function parseSummary(text: string, duration: number, evidence?: TranscriptSegment[]): SummaryResult {
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new ProcessingError('The summary response was incomplete. Retry to generate the summary again.', true) }
  const item = record(value)
  if (typeof item.title !== 'string' || !item.title.trim() || typeof item.summary !== 'string' || !item.summary.trim() || !Array.isArray(item.actionItems)) throw new ProcessingError('The summary did not contain a title, summary and action items. Retry to generate it again.', true)
  if (item.actionItems.length > 200 || item.summary.length > 100000) throw new ProcessingError('The summary response exceeded the supported size.')
  const actionItems = item.actionItems.map(a => {
    const action = record(a)
    if (typeof action.text !== 'string' || !action.text.trim() || action.text.length > 2000 || (action.start !== null && (typeof action.start !== 'number' || !Number.isFinite(action.start) || action.start < 0 || action.start > duration))) throw new ProcessingError('The summary contained an invalid action item or timestamp. Retry to generate it again.', true)
    if (action.dueDate !== undefined && action.dueDate !== null && !isDateOnly(action.dueDate)) throw new ProcessingError('The summary contained an invalid due date. Retry to generate it again.', true)
    if (action.owner !== undefined && action.owner !== null && (typeof action.owner !== 'string' || action.owner.length > 160)) throw new ProcessingError('The summary contained an invalid action owner.', true)
    const owner = typeof action.owner === 'string' && action.owner.trim() && (!evidence || groundedName(action.owner, evidence)) ? action.owner.trim() : null
    return { text: action.text.trim(), start: action.start as number | null, ...(action.owner === undefined ? {} : { owner }), ...(action.dueDate === undefined ? {} : { dueDate: action.dueDate as string | null }) }
  })
  const summary: SummaryResult = { title: conciseRecordingTitle(item.title), summary: item.summary.trim(), actionItems }
  if (item.outcomes !== undefined) {
    if (!Array.isArray(item.outcomes) || item.outcomes.length > 80) throw new ProcessingError('The summary contained invalid meeting outcomes. Retry to generate it again.', true)
    summary.outcomes = parseSummaryOutcomes(item.outcomes, evidence ?? [])
    summary.summary = renderSummaryOutcomes(summary.summary, summary.outcomes)
  }
  if (evidence || item.meetingType !== undefined) {
    if (typeof item.meetingType !== 'string' || !item.meetingType.trim() || item.meetingType.length > 100 || !Array.isArray(item.tags) || item.tags.length < 3 || item.tags.length > 7 || item.tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.trim().length > 40 || /[\u0000-\u001f]/.test(tag))) throw new ProcessingError('The summary did not include a valid meeting type and 3–7 tags.', true)
    summary.meetingType = item.meetingType.trim()
    summary.tags = [...new Set(item.tags.map(tag => String(tag).trim().toLowerCase()))]
    if (summary.tags.length < 3) throw new ProcessingError('Use at least three distinct meeting tags.', true)
    summary.participants = parseMeetingParticipants(item.participants, evidence ?? [])
    renderSummaryActions(summary)
  }
  return summary
}
