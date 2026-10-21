import type { AISettings } from '../../../src/shared/ai'
import type { TranscriptSegment } from '../../../src/shared/contracts'
import type { ChatProvider, SummaryResult } from './providers'
import { renderSummaryActions } from './summary-metadata'
import type { ReferenceContextSnapshot } from '../../../src/shared/reference-context'

export async function summarizeMeeting(chat: ChatProvider, model: string, segments: TranscriptSegment[], settings: AISettings, recordedAt: string | undefined, stage: (progress: number, message: string) => void, signal?: AbortSignal, referenceContext?: ReferenceContextSnapshot): Promise<SummaryResult> {
  const parts: TranscriptSegment[][] = [[]]
  let characters = 0
  for (const segment of segments) {
    if (characters + segment.text.length > 60000 && parts[parts.length - 1].length) { parts.push([]); characters = 0 }
    parts[parts.length - 1].push(segment); characters += segment.text.length + 120
  }
  const context = { recordedAt, evidenceSegments: segments, referenceContext }
  const summaries: SummaryResult[] = []
  for (const [index, part] of parts.entries()) {
    signal?.throwIfAborted(); stage(index / parts.length, `Summarizing part ${index + 1} of ${parts.length}…`)
    summaries.push(await chat.summarize(model, part, settings, signal, context))
  }
  let summary = summaries[0]
  if (summaries.length > 1) {
    summary = await chat.summarize(model, summaries.map((part, index) => ({ id: String(index), start: parts[index][0].start, end: parts[index][parts[index].length - 1].end, text: JSON.stringify(part), speakerId: null, speakerName: null })), settings, signal, context)
    summary.actionItems = summaries.flatMap(part => part.actionItems).filter((item, index, all) => all.findIndex(other => other.text.toLowerCase() === item.text.toLowerCase()) === index)
    renderSummaryActions(summary)
  }
  return summary
}
