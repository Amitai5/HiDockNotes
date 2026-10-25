import type { RecordingStatus } from './contracts'

export type ProviderId = 'gemini' | 'openai'
export type TranscriptionProviderId = ProviderId | 'local'
export type ChatProviderId = ProviderId | 'chatgpt'
export interface ModelChoice { id: string; name: string; transcription: boolean; chat: boolean }
export interface ProviderSelection { provider: TranscriptionProviderId; model: string }
export interface ChatSelection { provider: ChatProviderId; model: string }
export interface AISettings {
  transcription: ProviderSelection
  chat: ChatSelection
  maxConcurrentTranscriptions: number
  maxConcurrentSummaries: number
  autoTranscribe: boolean
  language: string
  summaryTemplate: 'meeting' | 'call' | 'interview' | 'dictation' | 'custom'
  customPrompt: string
  suggestThreshold: number
  autoAssignThreshold: number
}
export interface ProviderState { provider: ProviderId; configured: boolean; verified: boolean; verifiedAt: string | null; models: ModelChoice[]; offline: boolean }
export interface ChatGPTProfileView { id: string; label: string; email: string | null; name: string | null; connected: boolean; planEnabled: boolean; models: ModelChoice[]; offline: boolean }
export interface ChatGPTState { profiles: ChatGPTProfileView[]; activeProfileId: string | null; connected: boolean; planEnabled: boolean; signingIn: boolean; error: string | null; welcomePending: boolean; models: ModelChoice[]; offline: boolean; usageBlocked: boolean }
export type ActiveProcessingJob = { id: string; title: string; stage: RecordingStatus; mode?: 'process' | 'summarize' | 'transcribe'; progress: number; message: string | null; startedAt: string | null }
export interface TranscriptionQueueView { activeJobs?: ActiveProcessingJob[]; waiting: number; waitingTranscriptions?: number; waitingSummaries?: number; reviewPaused?: boolean; active: { id: string; title: string; stage: RecordingStatus; mode?: 'process' | 'summarize' | 'transcribe'; progress: number; message: string | null; startedAt: string | null } | null }
export interface AIState { settings: AISettings; providers: ProviderState[]; ready: boolean; reason: string | null; chatgpt?: ChatGPTState; summaryReady?: boolean; summaryReason?: string | null; queue?: TranscriptionQueueView }
export interface ProcessingView { stage: RecordingStatus; progress: number; message: string | null; error: string | null; attempt: number; nextAttemptAt: string | null; mode?: 'process' | 'summarize' | 'transcribe' }
export interface SpeakerView { id: string; label: string; profileId: string | null; suggestedProfileId: string | null; suggestedName: string | null; score: number | null; canRemember: boolean }
export interface VoiceSampleView { id: string; recordingId: string | null; recordingTitle: string | null; createdAt: string }
export interface VoiceProfileView { id: string; name: string; samples: VoiceSampleView[] }
export interface ChatMessage { role: 'user' | 'assistant'; content: string }
export interface RecordingCitation { kind?: 'recording'; number: number; recordingId: string; title: string; start: number; excerpt: string }
export interface WrittenNoteCitation { kind: 'note'; number: number; noteId: string; revision: number; blockId: string; heading: string | null; title: string; projectId: string | null; projectName: string | null; excerpt: string }
export type SourceCitation = RecordingCitation | WrittenNoteCitation
export interface AssistantAnswer { text: string; citations: SourceCitation[] }

export const DEFAULT_AI_SETTINGS: AISettings = {
  transcription: { provider: 'local', model: 'whisper-base' },
  chat: { provider: 'gemini', model: 'gemini-3.5-flash' },
  maxConcurrentTranscriptions: 1, maxConcurrentSummaries: 1,
  autoTranscribe: true, language: 'auto', summaryTemplate: 'meeting', customPrompt: '',
  suggestThreshold: 0.6, autoAssignThreshold: 0.75
}
export const LOCAL_TRANSCRIPTION_MODELS: ModelChoice[] = [
  { id: 'whisper-base', name: 'Whisper Base · multilingual · faster (recommended)', transcription: true, chat: false },
  { id: 'whisper-small', name: 'Whisper Small · multilingual · higher accuracy, slower', transcription: true, chat: false }
]
export const DEFAULT_MODELS: Record<ProviderId, ModelChoice[]> = {
  gemini: [
    { id: 'gemini-3.5-transcribe', name: 'Gemini 3.5 Transcribe · word timestamps', transcription: true, chat: false },
    { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', transcription: false, chat: true }
  ],
  openai: [
    { id: 'whisper-1', name: 'Whisper · word timestamps', transcription: true, chat: false },
    { id: 'gpt-4o-transcribe-diarize', name: 'GPT-4o Transcribe Diarize · segment timestamps', transcription: true, chat: false },
    { id: 'gpt-5.4-mini', name: 'GPT-5.4 mini', transcription: false, chat: true }
  ]
}
// Account-specific models replace this offline starting choice after sign-in.
export const DEFAULT_CHATGPT_MODELS: ModelChoice[] = [{ id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', transcription: false, chat: true }]
