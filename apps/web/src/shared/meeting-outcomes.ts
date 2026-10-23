export const OUTCOME_KINDS = ['decision', 'open_question', 'risk', 'next_step'] as const
export type OutcomeKind = typeof OUTCOME_KINDS[number]
export interface MeetingOutcome {
  kind: OutcomeKind
  text: string
  answerer: string | null
  start: number | null
  evidence: string | null
  source: 'transcript' | 'summary'
}
export const MAX_MEETING_OUTCOMES = 80
export const OUTCOME_HEADINGS: Record<OutcomeKind, string> = { decision: 'Decisions', open_question: 'Open questions', risk: 'Risks / blockers', next_step: 'Next steps' }
export function isOutcomeKind(value: unknown): value is OutcomeKind { return OUTCOME_KINDS.some(kind => kind === value) }

/** Reads bounded outcome metadata, including backups made before outcomes were structured. */
export function readMeetingOutcomes(value: string | null | undefined, summary: string): MeetingOutcome[] {
  if (value == null) return legacyMeetingOutcomes(summary)
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { return [] }
  if (!Array.isArray(parsed)) return []
  return parsed.slice(0, MAX_MEETING_OUTCOMES).flatMap((item: Partial<MeetingOutcome> | null) => {
    if (!item || !isOutcomeKind(item.kind) || typeof item.text !== 'string' || !item.text.trim() || item.text.length > 2000) return []
    return [{ kind: item.kind, text: item.text.trim(), answerer: typeof item.answerer === 'string' ? item.answerer.slice(0, 160) : null, start: typeof item.start === 'number' && Number.isFinite(item.start) && item.start >= 0 ? item.start : null, evidence: typeof item.evidence === 'string' ? item.evidence.slice(0, 1000) : null, source: item.source === 'transcript' ? 'transcript' as const : 'summary' as const }]
  })
}

/** Older notes remain searchable without fabricating transcript quotes or timestamps. */
export function legacyMeetingOutcomes(summary: string): MeetingOutcome[] {
  const result: MeetingOutcome[] = []
  let kind: OutcomeKind | undefined
  let depth = 0
  for (const line of summary.slice(0, 100000).split(/\r?\n/)) {
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (heading && heading[1].length <= (depth || 6)) {
      const title = heading[2].replace(/[*_]/g, '').replace(/\s*[:—-]\s*$/, '').trim().toLowerCase()
      kind = OUTCOME_KINDS.find(value => OUTCOME_HEADINGS[value].toLowerCase() === title || value === 'risk' && /^(risks|blockers|risks\s*\/\s*blockers)$/.test(title))
      depth = kind ? heading[1].length : 0
      continue
    }
    if (!kind || !line.trim() || heading || /^\s*\|/.test(line)) continue
    const text = line.trim().replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, '').trim()
    if (!text || /^(?:none(?: recorded)?|not (?:recorded|discussed)|n\/a)[.!]?$/i.test(text.replace(/[*_`]/g, ''))) continue
    if (!result.some(item => item.kind === kind && item.text === text)) result.push({ kind, text: text.slice(0, 2000), answerer: null, start: null, evidence: null, source: 'summary' })
    if (result.length >= MAX_MEETING_OUTCOMES) break
  }
  return result
}
