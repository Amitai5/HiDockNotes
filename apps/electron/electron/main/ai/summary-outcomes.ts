import type { TranscriptSegment } from '../../../src/shared/contracts'
import { MAX_MEETING_OUTCOMES, OUTCOME_HEADINGS, OUTCOME_KINDS, type MeetingOutcome } from '../../../src/shared/meeting-outcomes'
import { groundedName } from './summary-metadata'

const normalized = (value: string): string => value.trim().replace(/\s+/g, ' ').toLowerCase()

/** Only source quotes present in the transcript can become newly generated outcomes. */
export function parseSummaryOutcomes(value: unknown, segments: TranscriptSegment[]): MeetingOutcome[] {
  if (!Array.isArray(value)) return []
  const result: MeetingOutcome[] = []
  for (const item of value.slice(0, MAX_MEETING_OUTCOMES)) {
    if (!item || typeof item !== 'object' || !OUTCOME_KINDS.includes(item.kind) || typeof item.text !== 'string' || !item.text.trim() || item.text.length > 2000 || typeof item.evidence !== 'string' || !item.evidence.trim() || item.evidence.length > 1000) continue
    const quote = normalized(item.evidence)
    // A short quote may straddle adjacent transcript segments. Match the current
    // transcript, then derive its time rather than trusting a generated number.
    const matches = segments.flatMap((segment, index) => {
      const window = segments.slice(index, index + 5).map(part => normalized(part.text)).join(' ')
      const position = window.indexOf(quote)
      return position >= 0 && position < normalized(segment.text).length ? [segment] : []
    })
    const source = matches.find(segment => typeof item.start === 'number' && item.start >= segment.start && item.start <= segment.end) ?? matches[0]
    if (!source || result.some(other => other.kind === item.kind && normalized(other.text) === normalized(item.text))) continue
    const answerer = item.kind === 'open_question' && typeof item.answerer === 'string' && item.answerer.length <= 160 && groundedName(item.answerer, segments) ? item.answerer.trim() : null
    result.push({ kind: item.kind, text: item.text.trim(), answerer, start: source.start, evidence: item.evidence.trim(), source: 'transcript' })
  }
  return result
}

function inline(value: string): string { return value.replace(/[\r\n]+/g, ' ').replace(/([\\`*_{}[\]<>])/g, '\\$1') }
function timestamp(start: number): string {
  const seconds = Math.floor(start)
  return seconds >= 3600 ? `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** Keeps the displayed outcome sections consistent with validated structured metadata. */
export function renderSummaryOutcomes(summary: string, outcomes: MeetingOutcome[]): string {
  for (const kind of OUTCOME_KINDS) {
    const heading = OUTCOME_HEADINGS[kind]
    const entries = outcomes.filter(item => item.kind === kind)
    const content = entries.length ? entries.map(item => `- ${inline(item.text)}${kind === 'open_question' ? ` — Expected answerer: ${inline(item.answerer ?? 'Unassigned')}.` : ''}${item.start !== null ? ` *(${timestamp(item.start)})*` : ''}`).join('\n') : 'None recorded.'
    const section = new RegExp('^## ' + heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\n[\\s\\S]*?(?=^## |$(?![\\s\\S]))', 'm')
    const replacement = `## ${heading}\n\n${content}\n\n`
    if (section.test(summary)) summary = summary.replace(section, () => replacement)
    else summary += '\n\n' + replacement
  }
  return summary.trim()
}
