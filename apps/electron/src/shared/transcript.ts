import type { TranscriptSegment } from './contracts'

export interface TranscriptRevision { version: number; createdAt: string; reason: string; segmentCount: number }
export interface TranscriptReview {
  version: number
  revisions: TranscriptRevision[]
  correctedSegments: string[]
  summaryStale: boolean
  candidate: null | { createdAt: string; segments: TranscriptSegment[]; merged: TranscriptSegment[]; corrections: number }
}
export type TranscriptCandidateChoice = 'keep-corrections' | 'replace' | 'discard'
