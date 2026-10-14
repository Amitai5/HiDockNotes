export const MAX_MEETING_PARTICIPANTS = 10
export interface MeetingParticipant { speakerId: string | null; name: string; organizer: boolean; evidence?: string | null }
export interface MeetingOverview { meetingType: string; participants: MeetingParticipant[] }
export type RecordingReprocessMode = 'summarize' | 'transcribe'
