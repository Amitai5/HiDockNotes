import { describe, expect, it } from 'vitest'
import { parseSummaryOutcomes, renderSummaryOutcomes } from '../ai/summary-outcomes'
import { parseSummary } from '../ai/provider-parsing'
import { legacyMeetingOutcomes } from '../../../src/shared/meeting-outcomes'
import type { TranscriptSegment } from '../../../src/shared/contracts'

const segment = (start: number, text: string, speakerName: string | null = 'Dana Lee'): TranscriptSegment => ({ id: String(start), start, end: start + 10, text, speakerId: 'dana', speakerName })
const segments = [segment(10, 'We approved the pilot. Dana Lee will check whether the API is ready.'), segment(20, 'The vendor delay is a risk. We agreed to meet on Friday.')]
const entries = [
  { kind: 'decision', text: 'The pilot was approved.', answerer: null, start: 999, evidence: 'We approved the pilot.' },
  { kind: 'open_question', text: 'Is the API ready?', answerer: 'Dana Lee', start: 10, evidence: 'Dana Lee will check whether the API is ready.' },
  { kind: 'risk', text: 'A vendor delay could block the pilot.', answerer: null, start: 20, evidence: 'The vendor delay is a risk.' },
  { kind: 'next_step', text: 'Meet on Friday.', answerer: null, start: 20, evidence: 'We agreed to meet on Friday.' }
]
describe('source-linked meeting outcomes', () => {
  it('preserves all four kinds and derives source timestamps from real quotes', () => {
    const outcomes = parseSummaryOutcomes(entries, segments)
    expect(outcomes.map(item => item.kind)).toEqual(['decision', 'open_question', 'risk', 'next_step'])
    expect(outcomes[0]).toMatchObject({ start: 10, evidence: 'We approved the pilot.', source: 'transcript' })
    expect(outcomes[1].answerer).toBe('Dana Lee')
  })
  it('drops invented quotes, duplicates and malformed metadata without guessing an answerer', () => {
    const outcomes = parseSummaryOutcomes([...entries, entries[0], { ...entries[0], evidence: 'We cancelled everything.' }, { ...entries[0], kind: 'instruction' }, null, { ...entries[1], text: 'Who will verify this?', answerer: 'Imaginary Person' }], segments)
    expect(outcomes).toHaveLength(5)
    expect(outcomes.at(-1)?.answerer).toBeNull()
    expect(parseSummaryOutcomes(entries, [])).toEqual([])
  })
  it('locates quotes spanning adjacent segments without attributing later quotes to an earlier turn', () => {
    const parts = [segment(0, 'We discussed the pilot.'), segment(30, 'We agreed to'), segment(40, 'meet on Friday.')]
    expect(parseSummaryOutcomes([{ ...entries[3], start: null, evidence: 'We agreed to meet on Friday.' }], parts)[0].start).toBe(30)
  })
  it('makes summary sections agree with validated outcomes, preserves actions, and renders missing sections', () => {
    const text = 'Purpose.\n\nOutcome.\n\n## Decisions\n\nInvented decision.\n\n## Action items\n\nExisting tasks.\n\n## Open questions\n\nWrong answerer.'
    const output = renderSummaryOutcomes(text, parseSummaryOutcomes(entries, segments))
    expect(output).toContain('The pilot was approved. *(0:10)*')
    expect(output).toContain('Expected answerer: Dana Lee.')
    expect(output).toContain('## Risks / blockers')
    expect(output).toContain('## Next steps')
    expect(output).toContain('Existing tasks.')
    expect(output).not.toMatch(/Invented decision|Wrong answerer/)
    expect(renderSummaryOutcomes('Purpose.', [])).toContain('## Decisions\n\nNone recorded.')
  })
  it('applies the same validated outcomes through the provider response parser', () => {
    const result = parseSummary(JSON.stringify({ title: 'Pilot', summary: 'Purpose.\n\nOutcome.', actionItems: [], meetingType: 'Planning', participants: [], tags: ['pilot', 'planning', 'meeting'], outcomes: entries }), 50, segments)
    expect(result.outcomes).toHaveLength(4)
    expect(result.summary).toContain('The pilot was approved. *(0:10)*')
    expect(result.summary).not.toContain('999')
  })
  it('reads older Markdown sections as summary-derived data without invented evidence or times', () => {
    const text = 'Introduction.\n\n## Decisions\n- Approved the pilot.\n\n## Action items\n- Send the plan.\n\n## Open questions\nNone recorded.\n\n## Risks / blockers\n- Vendor dependency.\n\n## Next steps\n1. Meet Friday.'
    expect(legacyMeetingOutcomes(text)).toEqual([
      { kind: 'decision', text: 'Approved the pilot.', answerer: null, start: null, evidence: null, source: 'summary' },
      { kind: 'risk', text: 'Vendor dependency.', answerer: null, start: null, evidence: null, source: 'summary' },
      { kind: 'next_step', text: 'Meet Friday.', answerer: null, start: null, evidence: null, source: 'summary' }
    ])
  })
})
