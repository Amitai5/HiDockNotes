import { appClient } from '../services/app-client'
import { useEffect, useState } from 'react'
import { Clock3, LoaderCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { AIState } from '../shared/ai'
import { formatDuration } from './ui'
import { reportError } from '../store/useAppStore'
import { ProcessingControls } from './ProcessingControls'

export function ProcessingQueue(): JSX.Element | null {
  const [state, setState] = useState<AIState | null>(null)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    let mounted = true
    const load = (): void => { void appClient.ai.getState().then(value => { if (mounted) setState(value) }).catch(reportError) }
    load()
    const unsubscribe = appClient.library.onChanged(load)
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => { mounted = false; unsubscribe(); clearInterval(timer) }
  }, [])
  const queue = state?.queue
  if (!state || !queue || !queue.active && !queue.waiting && !queue.reviewPaused) return null
  const active = queue.active, summaries = queue.waitingSummaries ?? 0
  const summaryOnly = (summaries > 0 && queue.waitingTranscriptions === 0 || active?.mode === 'summarize') && !queue.waitingTranscriptions
  const ready = summaryOnly ? state.summaryReady : state.ready
  const reason = summaryOnly ? state.summaryReason : state.reason
  const elapsed = active?.startedAt ? Math.max(0, (now - new Date(active.startedAt).getTime()) / 1000) : 0
  const title = active ? active.mode === 'summarize' ? 'Refreshing a summary' : 'Processing your recordings' : queue.reviewPaused ? summaryOnly ? 'Summary refreshes are paused' : 'Background processing is paused' : ready ? summaryOnly ? 'Starting summary refreshes' : 'Starting transcription' : summaryOnly ? 'Summaries are waiting' : 'Transcription is waiting'
  return <>
    <section className="processing-queue" aria-label="Processing queue" role="status">
      <div className="queue-heading">{active ? <LoaderCircle className="animate-spin" size={18} /> : <Clock3 size={18} />}<div><strong>{title}</strong><p>{active ? active.message ?? active.stage : summaryOnly ? 'These recordings already have transcripts. Only their summaries are waiting to be refreshed.' : reason ?? 'Starting the background processor…'}</p></div><span>{summaryOnly ? `${summaries} summary refresh${summaries === 1 ? '' : 'es'}` : `${queue.waiting} waiting`}</span></div>
      {active && <><div className="queue-recording"><Link to={`/library/${active.id}`}>{active.title}</Link><small>{elapsed > 0 ? `${formatDuration(elapsed)} elapsed · ` : ''}{active.mode === 'summarize' ? 'Using the saved transcript' : 'Audio is already saved on this computer'}</small></div><progress aria-label={`${active.stage} progress`} max={1} value={active.progress > 0 ? active.progress : undefined} /></>}
      {!active && !ready && !queue.reviewPaused && <Link to="/settings?tab=ai">{summaryOnly ? 'Review summary settings' : 'Review transcription settings'}</Link>}
      <ProcessingControls state={state} onChanged={setState} allowCancelSummaries />
      <small>{summaryOnly ? 'No new download or transcription is needed. Paused summary jobs do not block recorder operations.' : 'One recording runs at a time. Waiting recordings do not need another download.'}</small>
    </section>
  </>
}
