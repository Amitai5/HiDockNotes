import { describe, expect, it } from 'vitest'
import type { TranscriptSegment } from '../../../src/shared/contracts'
import { DEFAULT_AI_SETTINGS } from '../../../src/shared/ai'
import { parseSummary } from '../ai/provider-parsing'
import { SUMMARY_SCHEMA, summaryInstructions } from '../ai/providers'

const segments: TranscriptSegment[] = [
  { id: 'one', start: 0, end: 3, text: "I'm Dana Lee, and I organized this meeting. I will send the plan.", speakerId: 'dana', speakerName: 'Unknown speaker 1' },
  { id: 'two', start: 3, end: 6, text: 'We should ask Chris Smith next week.', speakerId: 'unknown', speakerName: 'Unknown speaker 2' }
]
const base = { title: 'Planning meeting', meetingType: 'Planning', participants: [{ speakerId: 'dana', name: 'Dana Lee', organizer: true, evidence: "I'm Dana Lee, and I organized this meeting." }], tags: ['PLANNING', 'Operations', 'meeting'], summary: 'Purpose paragraph.\n\nOutcome paragraph.\n\n## Decisions\n\nNone recorded.\n\n## Action items\n\nBad model table.\n\n## Open questions\n\nNone recorded.', actionItems: [{ text: 'Send the plan', owner: 'Dana Lee', start: 0, dueDate: null }] }
const parse = (patch: object = {}) => parseSummary(JSON.stringify({ ...base, ...patch }), 6, segments)
describe('grounded meeting summaries', () => {
  it('requires the requested sections, bounded participant metadata and lower-case tags in every template', () => {
    for (const summaryTemplate of ['meeting', 'call', 'interview', 'dictation', 'custom'] as const) {
      const prompt = summaryInstructions({ ...DEFAULT_AI_SETTINGS, summaryTemplate })
      for (const section of ['2–4 paragraphs', 'Key discussion points', 'Decisions', 'Action items', 'Open questions', 'Risks / blockers', 'Next steps', 'Unassigned', 'No date', 'Never expand a partial name']) expect(prompt).toContain(section)
    }
    expect(SUMMARY_SCHEMA.properties.participants.maxItems).toBe(10)
    expect(parse().tags).toEqual(['planning', 'operations', 'meeting'])
  })
  it('extracts an explicitly introduced full name and organizer, and fills unknown speaking attendees', () => {
    expect(parse().participants).toEqual([{ ...base.participants[0] }, { speakerId: 'unknown', name: 'Unknown speaker 2', organizer: false }])
    expect(parse().summary).toContain('| Send the plan | Dana Lee | No date |')
    expect(parse().summary).not.toContain('Bad model table')
    expect(parse().summary).toContain('## Open questions')
  })
  it('rejects invented surnames, mere mentions, unsupported organizers and identities attributed to the wrong voice', () => {
    const result = parse({ participants: [
      { speakerId: 'dana', name: 'Dana Lee-Jones', organizer: true, evidence: "I'm Dana Lee, and I organized this meeting." },
      { speakerId: 'unknown', name: 'Dana Lee', organizer: true, evidence: "I'm Dana Lee, and I organized this meeting." },
      { speakerId: null, name: 'Chris Smith', organizer: false, evidence: 'We should ask Chris Smith next week.' }
    ] })
    expect(result.participants!.map(person => person.name)).toEqual(['Unknown speaker 1', 'Unknown speaker 2'])
    expect(result.participants!.map(person => person.organizer)).toEqual([true, false])
  })
  it('uses a trusted partial speaker name without inventing a surname or a role', () => {
    const result = parseSummary(JSON.stringify({ ...base, participants: [{ speakerId: 'dana', name: 'Dana Jones', organizer: true, evidence: null }] }), 6, [{ ...segments[0], speakerName: 'Dana' }])
    expect(result.participants).toEqual([{ speakerId: 'dana', name: 'Dana', organizer: false, evidence: null }])
  })
  it('rejects hundreds of model-generated participants and invalid tags rather than persisting them', () => {
    expect(parse({ participants: Array.from({ length: 240 }, () => base.participants[0]) }).participants).toHaveLength(2)
    expect(() => parse({ tags: ['one', 'ONE', 'two'] })).toThrow('distinct')
    expect(() => parse({ tags: ['one', 'two'] })).toThrow('3–7')
  })
  it('uses Unassigned and No date instead of accepting an invented action owner and safely renders literal dollar and pipe characters', () => {
    const result = parse({ actionItems: [{ text: 'Send $& | the plan', owner: 'Imaginary Person', start: 0, dueDate: null }] })
    expect(result.actionItems[0].owner).toBeNull()
    expect(result.summary).toContain('| Send $& \\| the plan | Unassigned | No date |')
  })
  it('deduplicates attendees that share a confirmed name or speaker ID', () => {
    expect(parse({ participants: [base.participants[0], base.participants[0]] }).participants).toHaveLength(2)
  })
  it('recovers missing evidence, invalid IDs and optional fields without failing a valid summary', () => {
    const result = parse({ participants: [{ name: 'Dana Lee', speakerId: 'invented-id', organizer: 'yes' }, null, { name: null }] })
    expect(result.participants!.map(person => person.name)).toEqual(['Unknown speaker 1', 'Unknown speaker 2'])
    expect(result.participants!.every(person => !person.organizer)).toBe(true)
    expect(result.summary).toContain('Purpose paragraph.')
  })
})
