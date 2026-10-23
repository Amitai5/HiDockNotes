import type { RecordingDetail } from '../../../src/shared/contracts'
import type { ExportContent, TranscriptFormat } from '../../../src/shared/export'

export type { TranscriptFormat } from '../../../src/shared/export'
export function subtitleTime(seconds: number, separator = ','): string {
  const milliseconds = Math.round(Math.max(0, seconds) * 1000)
  return `${String(Math.floor(milliseconds / 3600000)).padStart(2, '0')}:${String(Math.floor(milliseconds / 60000) % 60).padStart(2, '0')}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, '0')}${separator}${String(milliseconds % 1000).padStart(3, '0')}`
}
export function exportTranscript(detail: RecordingDetail, format: TranscriptFormat, content: ExportContent = 'summary-transcript'): string {
  if (format === 'srt' || format === 'vtt') {
    const lines = detail.segments.map((segment, index) => `${format === 'srt' ? String(index + 1) + '\n' : ''}${subtitleTime(segment.start, format === 'srt' ? ',' : '.')} --> ${subtitleTime(segment.end, format === 'srt' ? ',' : '.')}\n${segment.speakerName ? segment.speakerName + ': ' : ''}${segment.text.replaceAll('\n\n', '\n')}`)
    return (format === 'vtt' ? 'WEBVTT\n\n' : '') + lines.join('\n\n') + '\n'
  }
  const markdown = format === 'md'
  return [
    `${markdown ? '# ' : ''}${detail.recording.title || detail.recording.filename}`, '', detail.recording.recordedAt, '',
    ...(detail.meeting ? [`Meeting type: ${detail.meeting.meetingType}`, `Participants: ${detail.meeting.participants.map(person => person.name + (person.organizer ? ' (Organizer)' : '')).join(', ')}`, ''] : []),
    ...(detail.tags?.length ? [`Tags: ${detail.tags.join(', ')}`, ''] : []),
    ...(detail.recording.summary ? [`${markdown ? '## ' : ''}Summary`, '', detail.recording.summary, ''] : []),
    ...(content === 'summary-transcript' && detail.actionables.length ? [`${markdown ? '## ' : ''}Action items`, '', ...detail.actionables.map(item => `${markdown ? '- ' : ''}[${item.done ? 'x' : ' '}] ${item.text}${item.owner ? ` — Owner ${item.owner}` : ''}${item.dueDate ? ` — Due ${item.dueDate}` : ''}${item.start !== null ? ` (${subtitleTime(item.start, '.')})` : ''}`), ''] : []),
    ...(content === 'summary-transcript' ? [`${markdown ? '## ' : ''}Transcript`, '', ...detail.segments.map(segment => `[${subtitleTime(segment.start, '.')}] ${segment.speakerName ?? 'Speaker'}: ${segment.text}`), ''] : [])
  ].join('\n')
}
