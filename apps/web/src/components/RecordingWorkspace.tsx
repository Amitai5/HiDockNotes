import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { uiScale } from '../services/ui-scale'

const MIN_PANEL = 300
const DEFAULT_PANEL = 480
export function RecordingWorkspace({ notes, media }: { notes: ReactNode; media: ReactNode }): JSX.Element {
  const root = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; width: number } | null>(null)
  const [width, setWidth] = useState(DEFAULT_PANEL)
  const [maximum, setMaximum] = useState(800)
  const [resizing, setResizing] = useState(false)
  useEffect(() => {
    const element = root.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const max = Math.max(MIN_PANEL, Math.floor(element.clientWidth - 350))
      setMaximum(max); setWidth(value => Math.min(max, Math.max(MIN_PANEL, value)))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const resize = (value: number): void => setWidth(Math.max(MIN_PANEL, Math.min(maximum, value)))
  return <div ref={root} className="recording-workspace" data-resizing={resizing} style={{ '--media-width': `${width}px` } as CSSProperties}>
    <div className="recording-main-scroll">{notes}</div>
    <div className="recording-resizer" role="separator" aria-label="Resize audio and transcript sidebar" aria-orientation="vertical" aria-valuemin={MIN_PANEL} aria-valuemax={maximum} aria-valuenow={width} tabIndex={0}
      onPointerDown={event => { if (event.button !== 0) return; drag.current = { x: event.clientX, width }; setResizing(true); event.currentTarget.setPointerCapture?.(event.pointerId); event.preventDefault() }}
      onPointerMove={event => { if (drag.current) resize(drag.current.width + (drag.current.x - event.clientX) / uiScale()) }}
      onPointerUp={() => { drag.current = null; setResizing(false) }} onLostPointerCapture={() => { drag.current = null; setResizing(false) }}
      onDoubleClick={() => resize(DEFAULT_PANEL)} onKeyDown={event => {
        const next = event.key === 'ArrowLeft' ? width + 20 : event.key === 'ArrowRight' ? width - 20 : event.key === 'Home' ? MIN_PANEL : event.key === 'End' ? maximum : null
        if (next !== null) { event.preventDefault(); resize(next) }
      }}><span /></div>
    <aside className="recording-media-sidebar" aria-label="Audio and transcript">{media}</aside>
  </div>
}
