export type ExportContent = 'summary' | 'summary-transcript'
export type TranscriptFormat = 'md' | 'txt' | 'srt' | 'vtt'
export interface RecordingExportOptions { content: ExportContent; format: TranscriptFormat; includeAudio: boolean }
export const DEFAULT_EXPORT_OPTIONS: RecordingExportOptions = { content: 'summary-transcript', format: 'md', includeAudio: false }
export function isSubtitleFormat(format: TranscriptFormat): boolean { return format === 'srt' || format === 'vtt' }
