import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

const MIN_SOURCE = 280
const DEFAULT_SOURCE = 370

export function AssistantWorkspace({ chat, source }: { chat: ReactNode; source: ReactNode | null }): JSX.Element {
  const root = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; width: number } | null>(null)
  const [width, setWidth] = useState(DEFAULT_SOURCE), [maximum, setMaximum] = useState(650), [resizing, setResizing] = useState(false)
  useEffect(() => {
    const element = root.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const max = Math.max(MIN_SOURCE, Math.min(650, element.clientWidth - 350))
      setMaximum(max); setWidth(value => Math.max(MIN_SOURCE, Math.min(max, value)))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const resize = (value: number): void => setWidth(Math.max(MIN_SOURCE, Math.min(maximum, value)))
  const endDrag = (): void => { drag.current = null; setResizing(false) }
  return <div ref={root} className={`assistant-workspace${source ? ' has-source' : ''}`} data-resizing={resizing} style={{ '--source-width': `${width}px` } as CSSProperties}>
    {chat}
    {source && <><div className="assistant-source-resizer" role="separator" aria-label="Resize source panel" aria-orientation="vertical" aria-valuemin={MIN_SOURCE} aria-valuemax={maximum} aria-valuenow={width} tabIndex={0}
      onPointerDown={event => { if (event.button !== 0) return; drag.current = { x: event.clientX, width }; setResizing(true); event.currentTarget.setPointerCapture?.(event.pointerId); event.preventDefault() }}
      onPointerMove={event => { if (drag.current) resize(drag.current.width + drag.current.x - event.clientX) }}
      onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag} onDoubleClick={() => resize(DEFAULT_SOURCE)} onKeyDown={event => {
        const next = event.key === 'ArrowLeft' ? width + 20 : event.key === 'ArrowRight' ? width - 20 : event.key === 'Home' ? MIN_SOURCE : event.key === 'End' ? maximum : null
        if (next !== null) { event.preventDefault(); resize(next) }
      }}><span /></div>{source}</>}
  </div>
}
