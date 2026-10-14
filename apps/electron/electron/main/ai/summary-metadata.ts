import type { TranscriptSegment } from '../../../src/shared/contracts'
import type { MeetingParticipant } from '../../../src/shared/meeting'
import { MAX_MEETING_PARTICIPANTS } from '../../../src/shared/meeting'
import type { SummaryResult } from './providers'

const normalized = (value: string): string => value.trim().replace(/\s+/g, ' ').toLowerCase()
export function groundedName(name: string, segments: TranscriptSegment[]): boolean {
  const needle = normalized(name)
  if (!needle || /^(unknown|speaker|unassigned)(\s|$)/i.test(needle)) return false
  return segments.some(segment => normalized(segment.speakerName ?? '') === needle || (' ' + normalized(segment.text).replace(/[^\p{L}\p{N}\s'-]/gu, ' ') + ' ').includes(' ' + needle + ' '))
}
export function parseMeetingParticipants(value: unknown, segments: TranscriptSegment[]): MeetingParticipant[] {
  // Recover malformed optional metadata without throwing away valid notes.
  // Names and roles still require transcript evidence; unknown IDs are never
  // accepted as new speakers or turned into voice profiles.
  const supplied = Array.isArray(value) ? value.slice(0, MAX_MEETING_PARTICIPANTS) : []
  const ids = [...new Set(segments.flatMap(segment => segment.speakerId ? [segment.speakerId] : []))]
  const source = normalized(segments.map(segment => segment.text).join(' '))
  const names = new Set<string>()
  const output: MeetingParticipant[] = []
  for (const [index, raw] of supplied.entries()) {
    if (!raw || typeof raw !== 'object' || typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 160) continue
    const exact = typeof raw.speakerId === 'string' && ids.includes(raw.speakerId) ? raw.speakerId : null
    const named = segments.find(segment => segment.speakerId && normalized(segment.speakerName ?? '') === normalized(raw.name))?.speakerId ?? null
    const item = { name: raw.name, speakerId: exact ?? named, organizer: raw.organizer === true, evidence: typeof raw.evidence === 'string' && raw.evidence.length <= 1000 ? raw.evidence : null }
    const label = segments.find(segment => segment.speakerId === item.speakerId)?.speakerName
    const suppliedNumber = /^(?:Unknown )?speaker (\d+)$/i.exec(label ?? '')?.[1]
    const number = suppliedNumber ? Number(suppliedNumber) : item.speakerId ? ids.indexOf(item.speakerId) + 1 : index + 1
    const evidence = item.evidence ? normalized(item.evidence) : ''
    const hasEvidence = !!evidence && source.includes(evidence)
    const trustedLabel = label && !/^(?:unknown |unassigned )?speaker\b/i.test(label) ? label : null
    const introduction = ' ' + evidence.replace(/[^\p{L}\p{N}\s'-]/gu, ' ') + ' '
    const selfIntroduction = item.speakerId && segments.some(segment => segment.speakerId === item.speakerId && normalized(segment.text).includes(evidence)) && ['my name is ', "i'm ", 'i am ', 'this is '].some(prefix => introduction.includes(' ' + prefix + normalized(item.name) + ' '))
    const attendeeIntroduction = item.speakerId === null && /\b(join\w*|attend\w*|with us|on (?:the|this) call|introduc\w*|present)\b/.test(evidence)
    // A person's name being mentioned does not make them an attendee, nor does
    // another speaker introducing themselves identify this speaker's voice.
    const identified = groundedName(item.name, segments) && (trustedLabel && normalized(trustedLabel) === normalized(item.name) || hasEvidence && evidence.includes(normalized(item.name)) && (selfIntroduction || attendeeIntroduction))
    if (!item.speakerId && !identified) continue
    const name = identified ? item.name.trim() : trustedLabel ?? `Unknown speaker ${Math.max(1, Math.min(MAX_MEETING_PARTICIPANTS, number))}`
    const organizer = item.organizer && hasEvidence && /\b(organiz\w*|organis\w*|host\w*|chair\w*|conven\w*)\b/.test(evidence) && (evidence.includes(normalized(name)) || !!item.speakerId && segments.some(segment => segment.speakerId === item.speakerId && normalized(segment.text).includes(evidence) && /\bi(?:'m| am| organized| organised| will host| will chair)\b/.test(evidence)))
    if (names.has(normalized(name)) || item.speakerId && output.some(participant => participant.speakerId === item.speakerId)) continue
    names.add(normalized(name)); output.push({ speakerId: item.speakerId, name, organizer: !!organizer, evidence: hasEvidence ? item.evidence : null })
  }
  for (const [index, id] of ids.entries()) {
    if (output.length >= MAX_MEETING_PARTICIPANTS || output.some(item => item.speakerId === id)) continue
    const label = segments.find(segment => segment.speakerId === id)?.speakerName
    const name = label && !/^(?:unknown |unassigned )?speaker\b/i.test(label) ? label : /^Unknown speaker \d+$/i.test(label ?? '') ? label! : `Unknown speaker ${index + 1}`
    if (!names.has(normalized(name))) { names.add(normalized(name)); output.push({ speakerId: id, name, organizer: false }) }
  }
  return output
}
function cell(value: string): string { return value.replaceAll('|', '\\|').replace(/[\r\n]+/g, ' ') }
export function renderSummaryActions(summary: SummaryResult): void {
  const table = summary.actionItems.length ? '| Task | Owner | Due date |\n| --- | --- | --- |\n' + summary.actionItems.map(item => `| ${cell(item.text)} | ${cell(item.owner ?? 'Unassigned')} | ${item.dueDate ?? 'No date'} |`).join('\n') : 'None recorded.'
  const section = /^## Action items\s*\n[\s\S]*?(?=^## |$(?![\s\S]))/m
  if (section.test(summary.summary)) summary.summary = summary.summary.replace(section, () => '## Action items\n\n' + table + '\n\n')
  else summary.summary += '\n\n## Action items\n\n' + table
}
