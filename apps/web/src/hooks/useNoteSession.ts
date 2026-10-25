import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useBlocker } from 'react-router-dom'
import { appClient } from '../services/app-client'
import { clientEvents } from '../services/http'
import { captureNoteDraftStore } from '../services/note-drafts'
import { NoteSession } from '../services/note-session'
import type { WrittenNote } from '../shared/notes'

export function useNoteSession(note: WrittenNote) {
  const [session] = useState(() => new NoteSession(note, appClient.notes, captureNoteDraftStore()))
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const blocker = useBlocker(() => session.dirty), handled = useRef<string | null>(null), latest = useRef(blocker)
  latest.current = blocker
  const [navigationFailed, setNavigationFailed] = useState(false)
  useEffect(() => {
    session.open()
    void session.loadRecovery()
    const off = appClient.notes.onChanged(event => { if (event.id === note.id) { if (event.deleted) void session.deleted(); else void session.refresh() } })
    const reconnect = (): void => { void session.refresh() }; clientEvents.addEventListener('reconnected', reconnect)
    const unload = (event: BeforeUnloadEvent): void => { if (session.dirty) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', unload)
    return () => { session.close(); off(); clientEvents.removeEventListener('reconnected', reconnect); window.removeEventListener('beforeunload', unload) }
  }, [session, note.id])
  useEffect(() => {
    if (blocker.state !== 'blocked') { handled.current = null; return }
    const key = blocker.location.key
    if (handled.current === key) return
    handled.current = key
    void session.flush().then(saved => { const current = latest.current; if (current.state !== 'blocked' || current.location.key !== key) return; if (saved) current.proceed(); else setNavigationFailed(true) })
  }, [blocker, session])
  return { session, state, navigationFailed, stay: () => { setNavigationFailed(false); if (blocker.state === 'blocked') blocker.reset() }, leave: () => { setNavigationFailed(false); if (blocker.state === 'blocked') blocker.proceed() } }
}
