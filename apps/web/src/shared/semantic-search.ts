export type SearchMode = 'keywords' | 'meaning'
export interface SearchMatch { kind: SearchMode; excerpt: string; start: number }
export interface SemanticSearchState {
  enabled: boolean; modelReady: boolean; setupOffered: boolean
  phase: 'idle' | 'downloading' | 'waiting' | 'indexing' | 'ready' | 'failed'
  progress: number; indexedRecordings: number; totalRecordings: number; error: string | null; modelBytes: number
}
export const EMPTY_SEMANTIC_STATE: SemanticSearchState = { enabled: false, modelReady: false, setupOffered: false, phase: 'idle', progress: 0, indexedRecordings: 0, totalRecordings: 0, error: null, modelBytes: 23685172 }
