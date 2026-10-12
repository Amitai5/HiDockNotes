import type { FileInfo } from '@hidock/jensen-protocol'
import type { PipelineState } from '../../electron/main/types/device-pipeline'
import type { AISettings, AIState, ProviderId, ProcessingView, SpeakerView, VoiceProfileView, ChatMessage, AssistantAnswer } from './ai'
import type { ActionablePatch } from './actionables'
import type { RecordingExportOptions } from './export'
import type { LibraryNavigation } from './library'
import type { AgentConnectionState, AgentSetupTarget } from './agents'

export type Unsubscribe = () => void
export type RecordingStatus = 'device-only' | 'downloaded' | 'queued' | 'converting' | 'diarizing' | 'transcribing' | 'identifying' | 'summarizing' | 'done' | 'failed' | 'empty'
export interface RecordingView { id: string; filename: string; title: string | null; recordedAt: string; duration: number | null; size: number; status: RecordingStatus; verified: boolean; hasAudio: boolean; projectId: string | null; summary: string | null; queuePosition?: number | null; processingMessage?: string | null; processingProgress?: number | null }
export interface TranscriptSegment { id: string; start: number; end: number; text: string; speakerId: string | null; speakerName: string | null }
export interface RecordingDetail { recording: RecordingView; segments: TranscriptSegment[]; actionables: ActionableView[]; processing?: ProcessingView; speakers?: SpeakerView[] }
export interface ProjectView { id: string; name: string; count: number }
export interface ActionableView { id: string; text: string; done: boolean; recordingId: string; start: number | null; createdAt?: string | null; dueDate?: string | null; completedAt?: string | null }
export interface AppSettings { name: string; autoConnect: boolean; autoDownload: boolean; appearance: 'light' | 'dark' | 'system'; recordingsPath: string }
export interface ActivityEntry { id: string; timestamp: string; type: 'info' | 'success' | 'warning' | 'error'; category: string; message: string; details?: string }
export interface DeviceFile extends FileInfo { localVerified?: boolean; active?: boolean }
export interface DownloadView { filename: string; fileSize: number; progress: number; status: 'pending' | 'downloading' | 'cancelling' | 'completed' | 'failed' | 'cancelled'; error?: string; cancelReason?: 'user' | 'interrupted' }
export interface DownloadState { queue: DownloadView[]; isPaused: boolean; isProcessing: boolean }
export interface ElectronAPI {
  app: { info(): Promise<{ name: string; version: string; electron: string; platform: string }>; minimize(): void; maximize(): void; close(): void; openRecordingsFolder(): Promise<void> }
  settings: { get(): Promise<AppSettings>; update(patch: Partial<Pick<AppSettings, 'name' | 'autoConnect' | 'autoDownload' | 'appearance'>>): Promise<AppSettings>; chooseStorage(): Promise<AppSettings | null> }
  devicePipeline: {
    getState(): Promise<PipelineState>; getFiles(): Promise<DeviceFile[]>; connect(): Promise<boolean>; disconnect(): Promise<void>; sync(): Promise<void>; cancel(): Promise<void>
    download(filenames: string[]): Promise<void>; deleteFile(filename: string, confirmed: boolean): Promise<{ result: string } | null>; syncTime(): Promise<void>; setAutoRecord(enabled: boolean): Promise<void>
    getDownloads(): Promise<DownloadState>; onState(callback: (state: PipelineState) => void): Unsubscribe; onFiles(callback: (files: DeviceFile[]) => void): Unsubscribe; onDownloads(callback: (state: DownloadState) => void): Unsubscribe
  }
  library: { navigation(): Promise<LibraryNavigation>; list(search?: string, status?: string): Promise<RecordingView[]>; detail(id: string): Promise<RecordingDetail>; rename(id: string, title: string): Promise<void>; waveform(id: string): Promise<{ peaks: number[]; duration: number }>; importAudio(): Promise<number>; exportText(id: string, options?: RecordingExportOptions): Promise<boolean>; onChanged(callback: () => void): Unsubscribe }
  agents: { state(): Promise<AgentConnectionState>; setEnabled(enabled: boolean): Promise<AgentConnectionState>; copySetup(target: AgentSetupTarget): Promise<void> }
  ai: { getState(): Promise<AIState>; updateSettings(patch: Partial<AISettings>): Promise<AIState>; verifyKey(provider: ProviderId, key: string): Promise<AIState>; refreshModels(provider: ProviderId): Promise<AIState>; removeKey(provider: ProviderId): Promise<AIState>; process(id: string): Promise<void>; processPending(): Promise<number>; chatgpt: { signIn(profileId: string | null): Promise<AIState>; cancelSignIn(): Promise<AIState>; select(profileId: string): Promise<AIState>; signOut(profileId: string): Promise<{ state: AIState; message: string | null }>; refreshModels(): Promise<AIState>; acknowledgeWelcome(): Promise<AIState>; manageUsage(): Promise<void>; resume(): Promise<AIState> } }
  voices: { list(): Promise<VoiceProfileView[]>; nameSpeaker(speakerId: string, name: string): Promise<void>; confirmSpeaker(speakerId: string): Promise<void>; rename(id: string, name: string): Promise<void>; merge(sourceId: string, targetId: string): Promise<void>; delete(id: string, confirmed: boolean): Promise<void>; deleteSample(id: string, confirmed: boolean): Promise<void> }
  assistant: { ask(question: string, projectId: string | null, history: ChatMessage[]): Promise<AssistantAnswer> }
  projects: { list(): Promise<ProjectView[]>; create(name: string): Promise<ProjectView>; assign(recordingId: string, projectId: string | null): Promise<void> }
  actionables: { list(): Promise<ActionableView[]>; update(id: string, patch: ActionablePatch): Promise<void> }
  activity: { list(): Promise<ActivityEntry[]>; clear(): Promise<void>; onEntry(callback: (entry: ActivityEntry) => void): Unsubscribe; onCleared(callback: () => void): Unsubscribe }
}
