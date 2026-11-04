export const BRIEFING_DAYS = [7, 30, 90] as const
export type BriefingDays = typeof BRIEFING_DAYS[number]
export interface BriefingOptions { days: BriefingDays }
export interface BriefingSource { number: number; recordingId: string; title: string; recordedAt: string; basis: 'transcript' | 'summary'; start: number | null; excerpt: string }
export interface BriefingItem { text: string; sources: number[] }
export interface BriefingContent { overview: BriefingItem[]; changes: BriefingItem[]; decisions: BriefingItem[]; questions: BriefingItem[] }
export interface ProjectBriefing { generatedAt: string; since: string; until: string; provider: string; model: string; content: BriefingContent; sources: BriefingSource[] }
export interface BriefingCoverage { recentMeetings: number; eligibleMeetings: number; includedMeetings: number; staleSummaries: number }
export interface ProjectBriefingState { project: { id: string; name: string }; days: BriefingDays; since: string; until: string; briefing: ProjectBriefing | null; sourcesChanged: boolean; busy: boolean; canGenerate: boolean; reason: string | null; coverage: BriefingCoverage }
export interface ProjectBriefingClient { get(projectId: string, options: BriefingOptions): Promise<ProjectBriefingState>; generate(projectId: string, options: BriefingOptions): Promise<ProjectBriefingState>; cancel(projectId: string): Promise<void> }
