import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { uiScale } from '../services/ui-scale'

const MIN_NAVIGATION = 200
const DEFAULT_NAVIGATION = 256
export function ResizableNavigation({ children }: { children: ReactNode }): JSX.Element {
  const root = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; width: number } | null>(null)
  const [width, setWidth] = useState(DEFAULT_NAVIGATION)
  const [maximum, setMaximum] = useState(440)
  const [resizing, setResizing] = useState(false)
  useEffect(() => {
    const element = root.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      // Leave enough room for the summary and the audio/transcript panel.
      const max = Math.max(MIN_NAVIGATION, Math.min(440, Math.floor(element.clientWidth - 650)))
      setMaximum(max); setWidth(value => Math.min(max, Math.max(MIN_NAVIGATION, value)))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const resize = (value: number): void => setWidth(Math.max(MIN_NAVIGATION, Math.min(maximum, value)))
  const endDrag = (): void => { drag.current = null; setResizing(false) }
  return <div ref={root} className="app-shell" data-navigation-resizing={resizing} style={{ '--navigation-width': `${width}px` } as CSSProperties}>
    {children}
    <div className="navigation-resizer" role="separator" aria-label="Resize navigation sidebar" aria-controls="navigation-sidebar" aria-orientation="vertical" aria-valuemin={MIN_NAVIGATION} aria-valuemax={maximum} aria-valuenow={width} tabIndex={0}
      onPointerDown={event => { if (event.button !== 0) return; drag.current = { x: event.clientX, width }; setResizing(true); event.currentTarget.setPointerCapture?.(event.pointerId); event.preventDefault() }}
      onPointerMove={event => { if (drag.current) resize(drag.current.width + (event.clientX - drag.current.x) / uiScale()) }}
      onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag} onDoubleClick={() => resize(DEFAULT_NAVIGATION)}
      onKeyDown={event => {
        const next = event.key === 'ArrowLeft' ? width - 20 : event.key === 'ArrowRight' ? width + 20 : event.key === 'Home' ? MIN_NAVIGATION : event.key === 'End' ? maximum : null
        if (next !== null) { event.preventDefault(); resize(next) }
      }}><span /></div>
  </div>
}
