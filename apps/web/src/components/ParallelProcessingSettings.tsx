import { useEffect, useState } from 'react'
import type { AISettings } from '../shared/ai'
import { Button } from './ui'

export function ParallelProcessingSettings({ settings, busy, save }: { settings: AISettings; busy: boolean; save(patch: Partial<AISettings>): Promise<void> }): JSX.Element {
  const [transcriptions, setTranscriptions] = useState(String(settings.maxConcurrentTranscriptions ?? 1)), [summaries, setSummaries] = useState(String(settings.maxConcurrentSummaries ?? 1))
  useEffect(() => { setTranscriptions(String(settings.maxConcurrentTranscriptions ?? 1)); setSummaries(String(settings.maxConcurrentSummaries ?? 1)) }, [settings.maxConcurrentTranscriptions, settings.maxConcurrentSummaries])
  return <div className="parallel-processing-settings">
    <h3>Parallel processing</h3><p>Transcriptions and summaries have separate limits and can run at the same time on your server.</p>
    <form className="parallel-processing-form" onSubmit={event => { event.preventDefault(); void save({ maxConcurrentTranscriptions: Number(transcriptions), maxConcurrentSummaries: Number(summaries) }) }}>
      <label>Simultaneous transcriptions<input aria-label="Simultaneous transcriptions" type="number" min={1} max={4} step={1} required value={transcriptions} disabled={busy} onChange={event => setTranscriptions(event.target.value)} /></label>
      <label>Simultaneous summaries<input aria-label="Simultaneous summaries" type="number" min={1} max={8} step={1} required value={summaries} disabled={busy} onChange={event => setSummaries(event.target.value)} /></label>
      <Button type="submit" disabled={busy}>Save parallelism</Button>
    </form>
    <small>These are upper limits, with no reserved resources. Higher limits use more server memory and provider requests. Lowering a limit lets current jobs finish before it applies.</small>
  </div>
}
