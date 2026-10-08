import { describe, expect, it } from 'vitest'
import { exportTranscript, subtitleTime } from '../transcript-export'
import type { RecordingDetail } from '../../../../src/shared/contracts'

const detail: RecordingDetail = { recording: { id: 'recording', filename: 'original.hda', title: 'My title', recordedAt: '2026-10-07T10:00:00Z', duration: 10, size: 100, status: 'done', verified: true, hasAudio: true, projectId: null, summary: 'A summary' }, segments: [{ id: 'segment', start: 1.25, end: 2.5, text: 'Send the plan.', speakerId: null, speakerName: 'Dana' }], actionables: [{ id: 'task', recordingId: 'recording', text: 'Send the plan', done: false, start: 1.25 }] }
describe('transcript exports', () => {
  it('exports the manual title, summary, tasks and named transcript to Markdown', () => {
    expect(exportTranscript(detail, 'md')).toContain('# My title')
    expect(exportTranscript(detail, 'md')).toContain('- [ ] Send the plan')
    expect(exportTranscript(detail, 'md')).toContain('Dana: Send the plan.')
  })
  it('exports real subtitle timestamps to SRT and WebVTT', () => {
    expect(exportTranscript(detail, 'srt')).toContain('1\n00:00:01,250 --> 00:00:02,500\nDana: Send the plan.')
    expect(exportTranscript(detail, 'vtt')).toContain('WEBVTT\n\n00:00:01.250 --> 00:00:02.500')
    expect(subtitleTime(59.9996)).toBe('00:01:00,000')
  })
})
