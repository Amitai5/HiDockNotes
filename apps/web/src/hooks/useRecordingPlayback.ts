import { useEffect, useRef, useState } from 'react'
import { reportError } from '../store/useAppStore'

/** Owns one recording's media element, including pending play requests. */
export function useRecordingPlayback(id: string, enabled: boolean, initialTime: number) {
  const audio = useRef<HTMLAudioElement>(null)
  const valid = useRef(false)
  const request = useRef(0)
  const pending = useRef(false)
  const startTime = useRef(initialTime)
  startTime.current = initialTime
  const [position, setPosition] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [rate, setRate] = useState(1)

  useEffect(() => {
    const element = audio.current
    if (!enabled || !element) return
    valid.current = true
    if (!element.getAttribute('src')) { element.src = `/api/v1/recordings/${id}/audio`; element.load() }
    const reset = (): void => { pending.current = false; setPlaying(false); setLoading(false) }
    const started = (): void => { if (valid.current && !element.paused) { pending.current = false; setPlaying(true); setLoading(false) } }
    const waiting = (): void => { if (valid.current && !element.paused) setLoading(true) }
    const update = (): void => { if (valid.current) setPosition(element.currentTime) }
    const metadata = (): void => {
      if (valid.current && Number.isFinite(startTime.current) && startTime.current > 0) {
        const next = Math.min(startTime.current, element.duration || startTime.current)
        element.currentTime = next; setPosition(next)
      }
    }
    const failed = (): void => { if (valid.current) { reset(); reportError(new Error('Audio could not be played. Check the recording file and try again.')) } }
    const events = { playing: started, waiting, stalled: waiting, pause: reset, ended: reset, emptied: reset, timeupdate: update, loadedmetadata: metadata, error: failed }
    for (const [name, listener] of Object.entries(events)) element.addEventListener(name, listener)
    return () => {
      valid.current = false; request.current++; pending.current = false
      for (const [name, listener] of Object.entries(events)) element.removeEventListener(name, listener)
      // Capture this exact element. React may already have cleared its ref, and
      // an outstanding play() must never keep the previous recording alive.
      element.pause(); element.removeAttribute('src'); element.load()
    }
  }, [id, enabled])
  useEffect(() => { if (enabled && audio.current && audio.current.readyState >= 1 && Number.isFinite(initialTime)) seek(initialTime) }, [enabled, initialTime])

  function seek(value: number): void {
    const element = audio.current
    if (!element || !valid.current || !Number.isFinite(value)) return
    const next = Math.max(0, Math.min(value, Number.isFinite(element.duration) ? element.duration : value))
    element.currentTime = next; setPosition(next)
  }
  async function playPause(): Promise<void> {
    const element = audio.current
    if (!element || !valid.current) return
    const token = ++request.current
    if (pending.current || !element.paused) {
      pending.current = false; element.pause(); setPlaying(false); setLoading(false); return
    }
    pending.current = true; setLoading(true)
    try {
      await element.play()
      if (!valid.current || token !== request.current || element !== audio.current) return
      pending.current = false; setPlaying(!element.paused); setLoading(false)
    } catch (error) {
      if (!valid.current || token !== request.current || element !== audio.current) return
      pending.current = false; setPlaying(false); setLoading(false)
      if (error instanceof DOMException && error.name === 'AbortError') return
      reportError(error)
    }
  }
  function changeRate(value: number): void { setRate(value); if (audio.current) audio.current.playbackRate = value }
  function suspend(value: boolean): void {
    request.current++; pending.current = false; valid.current = !value
    setPlaying(false); setLoading(false); setPosition(0)
    if (!audio.current) return
    audio.current.pause()
    if (value) { audio.current.removeAttribute('src'); audio.current.load() }
    else { audio.current.src = `/api/v1/recordings/${id}/audio`; audio.current.load() }
  }
  return { audio, position, playing, loading, rate, seek, playPause, changeRate, suspend }
}
