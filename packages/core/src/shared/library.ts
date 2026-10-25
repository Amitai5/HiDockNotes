import type { ProjectView, RecordingView } from './contracts'

export interface LibraryNavigation {
  noteProjects?: Record<string, string | null>
  projects: ProjectView[]
  looseRecordings: Pick<RecordingView, 'id' | 'filename' | 'title'>[]
  projectRecordings?: Record<string, Pick<RecordingView, 'id' | 'filename' | 'title'>[]>
}

import type { LibraryScope, WrittenNoteView } from './notes'
export type LibraryContentRow = WrittenNoteView | { kind: 'recording'; id: string; title: string; projectId: string | null; projectName: string | null; createdAt: string; updatedAt: string; preview: string; recording: RecordingView }
export interface LibraryContentOptions { scope?: LibraryScope; query?: string; kind?: 'all' | 'note' | 'recording'; status?: string; from?: string; limit?: number; cursor?: string | null; mode?: 'keywords' | 'meaning' }
export interface LibraryContentPage { items: LibraryContentRow[]; total: number; nextCursor: string | null; fallbackReason?: string | null }
