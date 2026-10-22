import type { ChatMessage, RecordingCitation } from './ai'

export interface ConversationView {
  id: string; title: string; projectId: string | null; projectName: string | null
  createdAt: string; updatedAt: string; version: number; messageCount: number; responding: boolean; draft: string
}
export interface SavedChatMessage extends ChatMessage { id: string; ordinal: number; createdAt: string; citations: RecordingCitation[] }
export interface ConversationDetail { conversation: ConversationView; messages: SavedChatMessage[]; hasEarlier: boolean }
