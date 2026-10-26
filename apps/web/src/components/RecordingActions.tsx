import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, Menu, RotateCcw, Sparkles, Trash2 } from 'lucide-react'
import type { RecordingView } from '../shared/contracts'
import type { RecordingReprocessMode } from '../shared/meeting'
import { RecordingDelete } from './RecordingDelete'
import { RecordingExport } from './RecordingExport'
import { RecordingReprocess } from './RecordingReprocess'
import { uiScale } from '../services/ui-scale'

export function RecordingActions({ expectedSpeakers, recording, canSummarize, canTranscribe, canProcess, processReady, retry, busy, onProcess, onQueued, onDeleting, onDeleted }: { expectedSpeakers?: number | null; recording: RecordingView; canSummarize: boolean; canTranscribe: boolean; canProcess: boolean; processReady: boolean; retry: boolean; busy: boolean; onProcess(): void; onQueued(): void; onDeleting?(value: boolean): void; onDeleted?(): void }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [action, setAction] = useState<RecordingReprocessMode | 'export' | 'delete' | null>(null)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const last = useRef(false)
  const id = useId()
  const restoreFocus = (): void => { trigger.current?.focus() }
  const restoreDialogFocus = (): void => {
    requestAnimationFrame(() => {
      const focused = document.activeElement
      // A user can already have opened the menu or tabbed elsewhere while
      // Chromium tears down the modal. Preserve that newer interaction.
      if (!focused || focused === document.body || focused === trigger.current) restoreFocus()
    })
  }
  function showMenu(focusLast = false): void {
    const rect = trigger.current?.getBoundingClientRect()
    if (!rect) return
    last.current = focusLast
    const scale = uiScale()
    setPosition({ left: Math.max(8, Math.min(window.innerWidth / scale - 232, rect.right / scale - 224)), top: rect.bottom / scale + 8 })
    setOpen(true)
  }
  useEffect(() => {
    if (!open) return
    const items = menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
    if (items?.length) items[last.current ? items.length - 1 : 0].focus()
    const dismiss = (event: PointerEvent | FocusEvent): void => {
      const target = event.target as Node | null
      if (target && !trigger.current?.contains(target) && !menu.current?.contains(target)) setOpen(false)
    }
    const close = (): void => setOpen(false)
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('focusin', dismiss)
    document.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('focusin', dismiss)
      document.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
    }
  }, [open])
  const items = [
    ...(canProcess ? [{ label: retry ? 'Retry processing' : 'Transcribe', icon: <Sparkles size={16} />, disabled: busy || !processReady, select: onProcess }] : []),
    { label: 'Resummarize', icon: <Sparkles size={16} />, disabled: !canSummarize, select: () => setAction('summarize') },
    { label: 'Retranscribe', icon: <RotateCcw size={16} />, disabled: !canTranscribe, select: () => setAction('transcribe') },
    { label: 'Export', icon: <Download size={16} />, disabled: false, select: () => setAction('export') },
    { label: 'Delete recording', icon: <Trash2 size={16} />, disabled: false, select: () => setAction('delete') }
  ]
  return <div className="recording-actions-toolbar">
    <button ref={trigger} type="button" aria-label="Recording actions" title="Recording actions" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} className="button button-secondary recording-actions-trigger" onClick={() => { if (open) { setOpen(false); restoreFocus() } else showMenu() }} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); showMenu(event.key === 'ArrowUp') } }}><Menu size={19} /></button>
    {open && createPortal(<div ref={menu} id={id} className="recording-actions-menu" role="menu" aria-label="Recording actions" style={position} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); restoreFocus(); return }
      // Restore the anchor before the browser's default Tab action so focus
      // leaves the portaled menu in the original document order.
      if (event.key === 'Tab') { setOpen(false); restoreFocus(); return }
      const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])
      if (!buttons.length || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
      buttons[next].focus()
    }}>{items.map(item => <button key={item.label} type="button" role="menuitem" tabIndex={-1} disabled={item.disabled} onClick={() => { setOpen(false); item.select() }}>{item.icon}<span>{item.label}</span></button>)}</div>, document.body)}
    <RecordingReprocess id={recording.id} expectedSpeakers={expectedSpeakers} canSummarize={canSummarize} canTranscribe={canTranscribe} onQueued={onQueued} mode={action === 'summarize' || action === 'transcribe' ? action : null} onModeChange={setAction} onClosed={restoreDialogFocus} />
    <RecordingDelete recording={recording} open={action === 'delete'} onOpenChange={value => setAction(value ? 'delete' : null)} onClosed={restoreDialogFocus} onDeleting={onDeleting} onDeleted={onDeleted} />
    <RecordingExport recording={recording} open={action === 'export'} onOpenChange={value => setAction(value ? 'export' : null)} onClosed={restoreDialogFocus} />
  </div>
}
