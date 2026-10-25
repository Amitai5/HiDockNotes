import { appClient } from '../services/app-client'
import { useRef, useState, type DragEvent } from 'react'
import { reportError } from '../store/useAppStore'

export const RECORDING_DRAG_TYPE = 'application/x-hidocknotes-recording'
export const NOTE_DRAG_TYPE = 'application/x-hidocknotes-note'
export function startRecordingDrag(event: DragEvent, id: string): void {
  event.dataTransfer.clearData(); event.dataTransfer.setData(RECORDING_DRAG_TYPE, id); event.dataTransfer.effectAllowed = 'move'; event.currentTarget.setAttribute('data-dragging', 'true')
}
export function startNoteDrag(event: DragEvent, id: string, revision: number): void {
  event.dataTransfer.clearData(); event.dataTransfer.setData(NOTE_DRAG_TYPE, JSON.stringify({ kind: 'note', id, revision })); event.dataTransfer.effectAllowed = 'move'; event.currentTarget.setAttribute('data-dragging', 'true')
}
export function endRecordingDrag(event: DragEvent): void { event.currentTarget.removeAttribute('data-dragging') }
export function useRecordingDrop(projectId: string | null) {
  const [over, setOver] = useState(false), [busy, setBusy] = useState(false)
  const depth = useRef(0), pending = useRef(false)
  const accepts = (event: DragEvent): boolean => event.dataTransfer.types.includes(RECORDING_DRAG_TYPE) || event.dataTransfer.types.includes(NOTE_DRAG_TYPE)
  return {
    over, busy,
    onDragEnter(event: DragEvent): void { if (accepts(event)) { event.preventDefault(); depth.current++; setOver(true) } },
    onDragOver(event: DragEvent): void { if (accepts(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } },
    onDragLeave(): void { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false) },
    onDrop(event: DragEvent): void {
      if (!accepts(event)) return
      event.preventDefault(); event.stopPropagation(); depth.current = 0; setOver(false)
      if (pending.current) return
      let action: () => Promise<unknown>
      try {
        if (event.dataTransfer.types.includes(NOTE_DRAG_TYPE)) {
          const value = JSON.parse(event.dataTransfer.getData(NOTE_DRAG_TYPE)) as { kind?: string; id?: string; revision?: number }
          if (value.kind !== 'note' || typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value.id) || !Number.isSafeInteger(value.revision) || value.revision! < 1) return
          action = async () => { const result = await appClient.notes.move(value.id!, projectId, value.revision!, crypto.randomUUID()); if (result.status === 'conflict') throw Error('This note changed. Refresh it before moving it.') }
        } else {
          const id = event.dataTransfer.getData(RECORDING_DRAG_TYPE)
          if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) return
          action = () => appClient.projects.assign(id, projectId)
        }
      } catch { return }
      pending.current = true; setBusy(true)
      void action().catch(reportError).finally(() => { pending.current = false; setBusy(false) })
    }
  }
}
