export interface ReferenceContext { background: string; people: string; terminology: string }
export interface ReferenceContextDocument { content: ReferenceContext; version: number; updatedAt: string | null }
export interface ReferenceContextSnapshot {
  globalVersion?: number
  global: ReferenceContext
  projects: { id: string; name: string; recordingIds: string[]; noteIds?: string[]; version?: number; content: ReferenceContext }[]
}

export const REFERENCE_CONTEXT_LIMITS = { background: 3000, people: 1500, terminology: 1500 } as const
export const EMPTY_REFERENCE_CONTEXT: ReferenceContext = { background: '', people: '', terminology: '' }
export function hasReferenceContext(content: ReferenceContext): boolean { return Object.values(content).some(value => value.trim().length > 0) }
