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
export interface TranscriptionQueueView { waiting: number; active: { id: string; title: string; stage: RecordingStatus; progress: number; message: string | null; startedAt: string | null } | null }
export interface AIState { settings: AISettings; providers: ProviderState[]; ready: boolean; reason: string | null; chatgpt?: ChatGPTState; summaryReady?: boolean; summaryReason?: string | null; queue?: TranscriptionQueueView }
export interface ProcessingView { stage: RecordingStatus; progress: number; message: string | null; error: string | null; attempt: number; nextAttemptAt: string | null }
export interface SpeakerView { id: string; label: string; profileId: string | null; suggestedProfileId: string | null; suggestedName: string | null; score: number | null; canRemember: boolean }
export interface VoiceSampleView { id: string; recordingId: string | null; recordingTitle: string | null; createdAt: string }
export interface VoiceProfileView { id: string; name: string; samples: VoiceSampleView[] }
export interface ChatMessage { role: 'user' | 'assistant'; content: string }
export interface RecordingCitation { number: number; recordingId: string; title: string; start: number; excerpt: string }
export interface AssistantAnswer { text: string; citations: RecordingCitation[] }

export const DEFAULT_AI_SETTINGS: AISettings = {
  transcription: { provider: 'local', model: 'whisper-base' },
  chat: { provider: 'gemini', model: 'gemini-3.5-flash' },
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
