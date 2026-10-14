import { describe, expect, it, vi } from 'vitest'
import { summarizeMeeting } from '../ai/meeting-summary'
import { DEFAULT_AI_SETTINGS } from '../../../src/shared/ai'
import type { TranscriptSegment } from '../../../src/shared/contracts'

describe('summarizing long meetings', () => {
  it('sends every section and retains grounded names, source timestamps and actions from all sections', async () => {
    const segments: TranscriptSegment[] = [0, 1, 2].map(index => ({ id: String(index), start: index * 100, end: index * 100 + 99, text: String(index).repeat(50000), speakerId: 'voice', speakerName: 'Dana Lee' }))
    const summarize = vi.fn(async (_model, part: TranscriptSegment[]) => ({ title: 'Planning', summary: 'Purpose.\n\nOutcome.\n\n## Action items\n\nNone recorded.', meetingType: 'Planning', participants: [{ speakerId: 'voice', name: 'Dana Lee', organizer: false }], tags: ['planning', 'client', 'meeting'], actionItems: part[0].id === '0' && part.length === 3 ? [] : [{ text: `Task ${part[0].id}`, start: part[0].start, owner: 'Dana Lee', dueDate: null }] }))
    const result = await summarizeMeeting({ summarize, chat: vi.fn() }, 'selected', segments, DEFAULT_AI_SETTINGS, '2026-10-07T10:00:00Z', vi.fn())
    expect(summarize).toHaveBeenCalledTimes(4)
    expect(summarize.mock.calls.slice(0, 3).flatMap(call => call[1])).toEqual(segments)
    expect(result.actionItems.map(item => item.start)).toEqual([0, 100, 200])
    expect(result.summary).toContain('| Task 2 | Dana Lee | No date |')
    const final = vi.mocked(summarize).mock.calls[3] as unknown as unknown[]
    expect(final[4]).toMatchObject({ recordedAt: '2026-10-07T10:00:00Z', evidenceSegments: segments })
  })
})
