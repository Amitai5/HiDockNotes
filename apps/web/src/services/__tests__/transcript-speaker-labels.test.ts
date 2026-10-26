import { describe, expect, it } from 'vitest'
import { labelTranscriptSpeakers } from '../transcript-speaker-labels'
import type { TranscriptSegment } from '../../shared/contracts'

function segment(id: string, speakerId: string | null, speakerName: string | null): TranscriptSegment { return { id, speakerId, speakerName, start: 1, end: 2, text: 'Exact saved words.' } }
describe('anonymous transcript speaker display', () => {
  it('numbers legacy anonymous IDs consistently across repeated turns and refreshes', () => {
    const input = [segment('a', 'first', 'Unknown speaker'), segment('b', 'second', null), segment('c', 'first', 'Unknown speaker')]
    const result = labelTranscriptSpeakers(input)
    expect(result.map(item => item.speakerName)).toEqual(['Unknown speaker 1', 'Unknown speaker 2', 'Unknown speaker 1'])
    expect(labelTranscriptSpeakers(input)).toEqual(result)
    expect(input[0].speakerName).toBe('Unknown speaker')
  })
  it('keeps known names and existing anonymous numbers, allocating without collisions', () => {
    const input = [segment('a', 'first', 'Amitai Erfanian'), segment('b', 'second', 'Unknown speaker 2'), segment('c', 'third', 'Unknown speaker')]
    expect(labelTranscriptSpeakers(input).map(item => item.speakerName)).toEqual(['Amitai Erfanian', 'Unknown speaker 2', 'Unknown speaker 1'])
  })
  it('calls truly unmatched speech unassigned without making disconnected turns one fictitious person', () => {
    const input = [segment('a', null, null), segment('b', null, 'Unknown speaker'), segment('c', null, 'Unassigned speaker')]
    expect(labelTranscriptSpeakers(input).map(item => [item.speakerId, item.speakerName])).toEqual([[null, 'Unassigned speech'], [null, 'Unassigned speech'], [null, 'Unassigned speech']])
  })
  it('preserves historical named excerpts without a voice ID and all text/timing', () => {
    const input = [segment('a', null, 'Dana Lee'), segment('b', 'anonymous', 'Unknown speaker')]
    expect(labelTranscriptSpeakers(input)[0]).toBe(input[0])
    expect(labelTranscriptSpeakers(input)[1]).toEqual({ ...input[1], speakerName: 'Unknown speaker 1' })
  })
})
