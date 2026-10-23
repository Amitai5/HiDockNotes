import { appClient } from '../services/app-client'
import { useRef, useState, type DragEvent } from 'react'
import { reportError } from '../store/useAppStore'

export const RECORDING_DRAG_TYPE = 'application/x-hidocknotes-recording'
export function startRecordingDrag(event: DragEvent, id: string): void {
  event.dataTransfer.clearData()
  event.dataTransfer.setData(RECORDING_DRAG_TYPE, id)
  event.dataTransfer.effectAllowed = 'move'
  event.currentTarget.setAttribute('data-dragging', 'true')
}
export function endRecordingDrag(event: DragEvent): void { event.currentTarget.removeAttribute('data-dragging') }

export function useRecordingDrop(projectId: string | null) {
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const depth = useRef(0)
  const pending = useRef(false)
  const accepts = (event: DragEvent): boolean => event.dataTransfer.types.includes(RECORDING_DRAG_TYPE)
  return {
    over, busy,
    onDragEnter(event: DragEvent): void { if (accepts(event)) { event.preventDefault(); depth.current++; setOver(true) } },
    onDragOver(event: DragEvent): void { if (accepts(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } },
    onDragLeave(): void { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false) },
    onDrop(event: DragEvent): void {
      if (!accepts(event)) return
      event.preventDefault(); event.stopPropagation(); depth.current = 0; setOver(false)
      const id = event.dataTransfer.getData(RECORDING_DRAG_TYPE)
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || pending.current) return
      pending.current = true; setBusy(true)
      void appClient.projects.assign(id, projectId).catch(reportError).finally(() => { pending.current = false; setBusy(false) })
    }
  }
}
