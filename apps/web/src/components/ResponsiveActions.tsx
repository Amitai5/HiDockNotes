import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { Button } from './ui'

/** Keeps secondary controls inline when space permits and in a disclosure in narrow panes. */
export function ResponsiveActions({ label, className = '', children }: { label: string; className?: string; children: ReactNode }): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null)
  const id = useId()
  useEffect(() => {
    if (!expanded) return
    const dismiss = (event: PointerEvent): void => {
      // A child action may have opened its own modal. Keep its return target visible.
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return
      if (event.target instanceof Node && !root.current?.contains(event.target)) setExpanded(false)
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('[role="dialog"], [role="alertdialog"]')) return
      event.preventDefault(); setExpanded(false); trigger.current?.focus()
    }
    document.addEventListener('pointerdown', dismiss); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape) }
  }, [expanded])
  return <div ref={root} className={`responsive-actions ${className}`} data-expanded={expanded} onClick={event => {
    if (event.target instanceof Element && event.target.closest('[data-close-actions]')) setExpanded(false)
  }}>
    <Button ref={trigger} className="responsive-actions-trigger" variant="ghost" aria-label={label} title={label} aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}><MoreHorizontal size={21} /></Button>
    <div id={id} className="responsive-actions-panel" role="group" aria-label={label}>{children}</div>
  </div>
}
