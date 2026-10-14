import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useState } from 'react'
import { UserRound, X } from 'lucide-react'
import type { SpeakerView, VoiceProfileView } from '../shared/ai'
import type { TranscriptSegment } from '../shared/contracts'
import { Button } from './ui'
import { reportError } from '../store/useAppStore'

export interface SpeakerEdit { speaker?: SpeakerView; segment?: TranscriptSegment }
export function isUnknownSpeaker(name: string): boolean { return /^(?:unknown|unassigned|speaker)(?:\s|$)/i.test(name.trim()) }
export function speakerColor(name: string): string {
  if (isUnknownSpeaker(name)) return 'speaker-unknown'
  let hash = 0
  for (const character of name.trim().toLowerCase()) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return `speaker-color-${hash % 10}`
}
export function speakerColors(names: string[]): Map<string, string> {
  const colors = new Map<string, string>(), used = new Set<number>()
  for (const name of [...new Set(names.map(value => value.trim().toLowerCase()))].sort()) {
    if (isUnknownSpeaker(name)) { colors.set(name, 'speaker-unknown'); continue }
    let index = Number(speakerColor(name).split('-').at(-1))
    while (used.has(index) && used.size < 10) index = (index + 1) % 10
    used.add(index); colors.set(name, `speaker-color-${index}`)
  }
  return colors
}
export function SpeakerEditor({ recordingId, edit, onClose, onSaved, onClosed }: { recordingId: string; edit: SpeakerEdit | null; onClose(): void; onSaved(): void; onClosed?(): void }): JSX.Element {
  const [name, setName] = useState(''), [profiles, setProfiles] = useState<VoiceProfileView[]>([])
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!edit) return
    const label = edit.speaker?.label ?? edit.segment?.speakerName ?? ''
    setName(isUnknownSpeaker(label) ? '' : label); setError(null)
    let active = true
    void window.electronAPI.voices.list().then(value => { if (active) setProfiles(value) }).catch(reportError)
    return () => { active = false }
  }, [edit])
  async function save(): Promise<void> {
    if (!edit) return
    setBusy(true); setError(null)
    try {
      if (edit.speaker) await window.electronAPI.voices.nameSpeaker(edit.speaker.id, name)
      else if (edit.segment) await window.electronAPI.voices.assignSegment(recordingId, edit.segment.id, name)
      onSaved(); onClose()
    } catch (value) { setError(value instanceof Error ? value.message : 'The speaker could not be saved.') }
    finally { setBusy(false) }
  }
  return <Dialog.Root open={edit !== null} onOpenChange={open => { if (!open && !busy) onClose() }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="confirmation-dialog speaker-dialog" onCloseAutoFocus={event => { if (onClosed) { event.preventDefault(); requestAnimationFrame(onClosed) } }} onEscapeKeyDown={event => { if (busy) event.preventDefault() }} onInteractOutside={event => { if (busy) event.preventDefault() }}>
    <div className="folder-dialog-heading"><span className="folder-dialog-icon"><UserRound size={21} /></span><Dialog.Title>Name this speaker</Dialog.Title><Dialog.Close asChild><Button variant="ghost" aria-label="Close speaker editor" disabled={busy}><X size={17} /></Button></Dialog.Close></div>
    <Dialog.Description>{edit?.speaker ? edit.speaker.canRemember ? 'Update this voice throughout the transcript and remember its clean sample on this machine.' : 'Update this speaker throughout the transcript. There is no clean voice sample to remember.' : 'Assign this unidentified segment to a person. It will not train a voice profile from uncertain audio.'}</Dialog.Description>
    <form className="speaker-form" onSubmit={event => { event.preventDefault(); void save() }}>
      <label htmlFor="speaker-profile">Saved voice</label><select id="speaker-profile" value={profiles.find(profile => profile.name === name)?.id ?? ''} onChange={event => setName(profiles.find(profile => profile.id === event.target.value)?.name ?? '')}><option value="">New person</option>{profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select>
      <label htmlFor="speaker-name">Speaker name</label><input id="speaker-name" autoFocus value={name} maxLength={80} placeholder="Enter their name" onChange={event => setName(event.target.value)} disabled={busy} />
      {error && <p role="alert" className="danger-text">{error}</p>}
      <div className="dialog-actions"><Button type="button" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" busy={busy} disabled={!name.trim() || isUnknownSpeaker(name)}>Save speaker</Button></div>
    </form>
  </Dialog.Content></Dialog.Portal></Dialog.Root>
}
