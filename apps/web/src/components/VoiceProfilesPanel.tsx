import { appClient } from '../services/app-client'
import * as AlertDialog from '@radix-ui/react-alert-dialog'
import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useState } from 'react'
import { ArrowUpRight, AudioLines, Check, ChevronRight, LoaderCircle, Merge, Mic2, Pencil, Trash2, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { VoiceProfileView } from '../shared/ai'
import { Button } from './ui'

function initials(name: string): string { return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toLocaleUpperCase() }
function errorMessage(value: unknown): string { return value instanceof Error ? value.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Could not save this change. Try again.' }

export function VoiceProfilesPanel(): JSX.Element {
  const [profiles, setProfiles] = useState<VoiceProfileView[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [mergeSourceId, setMergeSourceId] = useState<string | null>(null)
  const [mergeTarget, setMergeTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmation, setConfirmation] = useState<{ title: string; description: string; action: () => Promise<void> } | null>(null)
  const selected = profiles.find(profile => profile.id === selectedId) ?? profiles[0]
  const mergeSource = profiles.find(profile => profile.id === mergeSourceId)
  function refresh(): Promise<void> { return appClient.voices.list().then(value => { setProfiles(value); setLoadError('') }) }
  useEffect(() => {
    let mounted = true
    const load = (): void => { void appClient.voices.list().then(value => { if (mounted) { setProfiles(value); setLoadError('') } }).catch(value => { if (mounted) setLoadError(errorMessage(value)) }).finally(() => { if (mounted) setLoading(false) }) }
    load()
    const unsubscribe = appClient.library.onChanged(load)
    return () => { mounted = false; unsubscribe() }
  }, [])
  async function perform(action: () => Promise<void>): Promise<boolean> {
    setBusy(true); setError('')
    try { await action(); await refresh(); setEditing(false); return true }
    catch (value) { setError(errorMessage(value)); return false }
    finally { setBusy(false) }
  }
  return <section className="settings-section" id="voice-profiles" tabIndex={-1}>
    <h2><Mic2 size={18} />Remembered voices</h2>
    {loading ? <div className="voice-loading" role="status"><LoaderCircle className="animate-spin" size={17} />Loading voices…</div> : loadError && !profiles.length ? <div className="voice-load-error" role="alert"><p>{loadError}</p><Button onClick={() => { setLoading(true); void refresh().catch(value => setLoadError(errorMessage(value))).finally(() => setLoading(false)) }}>Retry</Button></div> : selected ? <div className="voice-browser">
      <div className="voice-list" role="group" aria-label="Remembered people">{profiles.map(profile => <button type="button" key={profile.id} className="voice-person" aria-label={`${profile.name}, ${profile.samples.length} sample${profile.samples.length === 1 ? '' : 's'}`} aria-pressed={selected.id === profile.id} disabled={busy} onClick={() => { setSelectedId(profile.id); setEditing(false); setError('') }}>
        <span className="voice-avatar" aria-hidden="true">{initials(profile.name)}</span><span className="voice-person-label"><strong>{profile.name}</strong><span>{profile.samples.length} sample{profile.samples.length === 1 ? '' : 's'}</span></span><ChevronRight size={15} aria-hidden="true" />
      </button>)}</div>
      <section className="voice-detail" aria-label={`${selected.name} voice samples`}>
        <div className="voice-detail-heading">{editing ? <form className="voice-name-form" onSubmit={event => { event.preventDefault(); if (name.trim()) void perform(() => appClient.voices.rename(selected.id, name.trim())) }}>
          <input autoFocus aria-label="Voice profile name" maxLength={80} value={name} disabled={busy} onChange={event => setName(event.target.value)} /><Button type="submit" aria-label="Save voice name" disabled={busy || !name.trim()}><Check size={15} />Save</Button><Button type="button" disabled={busy} onClick={() => { setEditing(false); setError('') }}>Cancel</Button>
        </form> : <><div><h3>{selected.name}</h3><span>{selected.samples.length} saved sample{selected.samples.length === 1 ? '' : 's'}</span></div><div className="voice-detail-actions">
          <Button variant="ghost" aria-label={`Rename ${selected.name}`} title="Rename voice" disabled={busy} onClick={() => { setSelectedId(selected.id); setName(selected.name); setEditing(true); setError('') }}><Pencil size={16} /></Button>
          {profiles.length > 1 && <Button variant="ghost" aria-label={`Merge ${selected.name}`} title="Merge voice" disabled={busy} onClick={() => { setMergeSourceId(selected.id); setMergeTarget(''); setError('') }}><Merge size={16} /></Button>}
          <Button variant="ghost" aria-label={`Delete ${selected.name}`} title="Delete voice" disabled={busy} onClick={() => { setError(''); setConfirmation({ title: `Delete ${selected.name}’s voice profile?`, description: 'Removes saved voice samples. Transcript names stay unchanged.', action: () => appClient.voices.delete(selected.id, true) }) }}><Trash2 size={16} /></Button>
        </div></>}</div>
        {error && !mergeSourceId && !confirmation && <p className="provider-error" role="alert">{error}</p>}
        {selected.samples.length ? <div className="voice-samples">{selected.samples.map(sample => <div className="voice-sample" key={sample.id}>
          <AudioLines size={18} aria-hidden="true" /><div className="voice-sample-label">{sample.recordingId ? <Link to={`/library/${sample.recordingId}`} aria-label={`Open sample from ${sample.recordingTitle ?? 'source recording'}`}>{sample.recordingTitle ?? 'Source recording'}<ArrowUpRight size={14} /></Link> : <span>Source recording unavailable</span>}<time dateTime={sample.createdAt} title={new Date(sample.createdAt).toLocaleString()}>{new Date(sample.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</time></div>
          <Button variant="ghost" disabled={busy} aria-label={`Delete voice sample from ${sample.recordingTitle ?? 'unavailable recording'}`} title="Delete sample" onClick={() => { setError(''); setConfirmation({ title: 'Delete this voice sample?', description: 'Removes this recognition sample. The recording and transcript are kept.', action: () => appClient.voices.deleteSample(sample.id, true) }) }}><Trash2 size={15} /></Button>
        </div>)}</div> : <div className="voice-samples-empty"><Mic2 size={24} /><strong>No samples yet</strong><p>Name a speaker in a transcript to add one.</p></div>}
      </section>
    </div> : <div className="inline-empty">No remembered voices. Name a speaker in a transcript to add one.</div>}
    <Dialog.Root open={mergeSourceId !== null} onOpenChange={open => { if (!open && !busy) { setMergeSourceId(null); setError('') } }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="confirmation-dialog voice-merge-dialog" onEscapeKeyDown={event => { if (busy) event.preventDefault() }} onInteractOutside={event => { if (busy) event.preventDefault() }}>
      <div className="panel-heading"><Dialog.Title>Merge {mergeSource?.name ?? 'voice'}</Dialog.Title><Dialog.Close asChild><Button variant="ghost" aria-label="Close merge dialog" disabled={busy}><X size={18} /></Button></Dialog.Close></div>
      <Dialog.Description>Combine samples and transcript names with another profile. Keeps the ten most recent samples.</Dialog.Description>
      <label className="voice-merge-target">Merge into<select aria-label="Merge into voice profile" value={mergeTarget} disabled={busy} onChange={event => setMergeTarget(event.target.value)}><option value="">Choose a person</option>{profiles.filter(profile => profile.id !== mergeSourceId).map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
      {error && <p className="provider-error" role="alert">{error}</p>}
      <div className="dialog-actions"><Button disabled={busy} onClick={() => { setMergeSourceId(null); setError('') }}>Cancel</Button><Button variant="primary" busy={busy} disabled={!mergeSource || !profiles.some(profile => profile.id === mergeTarget && profile.id !== mergeSourceId)} onClick={() => { if (mergeSource) void perform(() => appClient.voices.merge(mergeSource.id, mergeTarget)).then(success => { if (success) { setSelectedId(mergeTarget); setMergeSourceId(null) } }) }}>Merge voices</Button></div>
    </Dialog.Content></Dialog.Portal></Dialog.Root>
    <AlertDialog.Root open={confirmation !== null} onOpenChange={open => { if (!open && !busy) { setConfirmation(null); setError('') } }}><AlertDialog.Portal><AlertDialog.Overlay className="dialog-overlay" /><AlertDialog.Content className="confirmation-dialog" onEscapeKeyDown={event => { if (busy) event.preventDefault() }}>
      <AlertDialog.Title>{confirmation?.title}</AlertDialog.Title><AlertDialog.Description>{confirmation?.description}</AlertDialog.Description>{error && <p className="provider-error" role="alert">{error}</p>}
      <div className="dialog-actions"><AlertDialog.Cancel asChild><Button disabled={busy}>Cancel</Button></AlertDialog.Cancel><AlertDialog.Action asChild><Button variant="danger" busy={busy} onClick={event => { event.preventDefault(); if (confirmation) void perform(confirmation.action).then(success => { if (success) setConfirmation(null) }) }}>Confirm</Button></AlertDialog.Action></div>
    </AlertDialog.Content></AlertDialog.Portal></AlertDialog.Root>
  </section>
}
