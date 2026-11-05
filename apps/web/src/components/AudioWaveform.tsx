export function AudioWaveform({ peaks, duration, position, onSeek, label = 'Seek in recording' }: { peaks: number[] | null; duration: number; position: number; onSeek(seconds: number): void; label?: string }): JSX.Element {
  return <div className="waveform">
    <svg viewBox="0 0 720 84" preserveAspectRatio="none" aria-hidden="true">{peaks?.length ? peaks.map((peak, index) => <rect key={index} x={index * 720 / peaks.length} y={42 - Math.max(2, peak * 38)} width={Math.max(1, 720 / peaks.length - 1.5)} height={Math.max(4, peak * 76)} rx="1.2" fill={duration > 0 && index / peaks.length <= position / duration ? 'var(--accent)' : 'var(--wave-muted)'} />) : <line x1="0" y1="42" x2="720" y2="42" stroke="var(--border)" />}</svg>
    <input className="waveform-seek" type="range" aria-label={label} min={0} max={duration || 1} step={0.1} value={Math.max(0, Math.min(position, duration))} disabled={duration <= 0} onChange={event => onSeek(Number(event.target.value))} onKeyDown={event => {
      const next = event.key === 'ArrowRight' ? position + 5 : event.key === 'ArrowLeft' ? position - 5 : event.key === 'Home' ? 0 : event.key === 'End' ? duration : null
      if (next !== null && duration > 0) { event.preventDefault(); onSeek(Math.max(0, Math.min(next, duration))) }
    }} />
  </div>
}
