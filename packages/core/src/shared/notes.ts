export type LibraryScope = { kind: 'all' } | { kind: 'unfiled' } | { kind: 'project'; projectId: string }
export interface NoteMark { type: 'bold' | 'italic' | 'underline' | 'link'; attrs?: { href?: string; target?: string | null; rel?: string | null; class?: null } }
export interface NoteNode { type: 'doc' | 'paragraph' | 'heading' | 'text' | 'hardBreak' | 'bulletList' | 'orderedList' | 'listItem' | 'taskList' | 'taskItem' | 'blockquote'; attrs?: { id?: string; level?: number; start?: number; checked?: boolean }; text?: string; marks?: NoteMark[]; content?: NoteNode[] }
export interface NoteDocument extends NoteNode { type: 'doc'; content: NoteNode[] }
export interface WrittenNoteView { kind: 'note'; id: string; title: string; projectId: string | null; projectName: string | null; revision: number; createdAt: string; updatedAt: string; preview: string; tags: string[] }
export interface WrittenNote extends WrittenNoteView { document: NoteDocument; documentSchema: 1; plainText: string }
export interface NotePage { notes: WrittenNoteView[]; nextCursor: string | null; total: number; consistency: 'live' }
export interface NoteListOptions { scope?: LibraryScope; query?: string; limit?: number; cursor?: string | null }
export interface NoteCreate { requestId: string; projectId: string | null; sourceId?: string; title?: string; document?: NoteDocument; tags?: string[] }
export interface NoteSave { title: string; document: NoteDocument; tags: string[]; expectedRevision: number; mutationId: string }
export type NoteMutationResult = { status: 'saved'; note: WrittenNote } | { status: 'conflict'; current: WrittenNote }
export interface NoteRevision { revision: number; title: string; createdAt: string }
export interface NoteBlock { id: string; part: number; type: string; heading: string | null; text: string; checked?: boolean; depth: number }
export interface NoteReadPage { note: WrittenNoteView; revision: number; blocks: NoteBlock[]; nextCursor: string | null; document?: NoteDocument }
export interface NoteSearchHit { noteId: string; title: string; projectId: string | null; projectName: string | null; revision: number; blockId: string; heading: string | null; excerpt: string; score?: number }
export interface NoteSearchPage { hits: NoteSearchHit[]; nextCursor: string | null; mode: 'keywords' | 'meaning'; fallbackReason: string | null; indexing?: boolean }
export interface NoteSearchOptions extends NoteListOptions { query: string; mode?: 'keywords' | 'meaning' }
export interface NotesClient {
  list(options?: NoteListOptions): Promise<NotePage>; get(id: string, revision?: number): Promise<WrittenNote>
  create(input: NoteCreate): Promise<WrittenNote>; save(id: string, input: NoteSave): Promise<NoteMutationResult>
  move(id: string, projectId: string | null, expectedRevision: number, mutationId: string): Promise<NoteMutationResult>
  delete(id: string, expectedRevision: number, confirmed: boolean): Promise<{ status: 'deleted' } | { status: 'conflict'; current: WrittenNote }>
  history(id: string): Promise<NoteRevision[]>; restoreRevision(id: string, revision: number, expectedRevision: number, mutationId: string): Promise<NoteMutationResult>
  export(id: string, format: 'markdown' | 'text'): Promise<{ text: string; filename: string }>
  onChanged(callback: (event: { id: string; deleted?: boolean }) => void): () => void
}
