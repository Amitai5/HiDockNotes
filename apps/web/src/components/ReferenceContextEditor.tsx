import { appClient } from '../services/app-client'
import * as Dialog from '@radix-ui/react-dialog'
import * as AlertDialog from '@radix-ui/react-alert-dialog'
import { useEffect, useId, useState } from 'react'
import { BookOpen, Check, X } from 'lucide-react'
import { EMPTY_REFERENCE_CONTEXT, REFERENCE_CONTEXT_LIMITS, type ReferenceContext, type ReferenceContextDocument } from '../shared/reference-context'
import { Button } from './ui'

const fields = [
  { key: 'background', label: 'Background', placeholder: 'Project, client, goals…', rows: 3 },
  { key: 'people', label: 'People & organizations', placeholder: 'Full name — role or organization\nOrganization — relevant background', rows: 4 },
  { key: 'terminology', label: 'Terminology & spellings', placeholder: 'Acronym — meaning\nProduct or term — preferred spelling', rows: 4 }
] as const

function message(value: unknown): string { return value instanceof Error ? value.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'The reference context could not be saved. Try again.' }

function useContextEditor(projectId: string | null, active: boolean) {
  const api = appClient.referenceContext
  const [document, setDocument] = useState<ReferenceContextDocument | null>(null)
  const [draft, setDraft] = useState<ReferenceContext>({ ...EMPTY_REFERENCE_CONTEXT })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!active || !api || document) return
    let current = true
    setLoading(true); setError('')
    void api.get(projectId).then(value => {
      if (!current) return
      setDocument(value); setDraft(value.content); setLoading(false)
    }).catch(value => { if (current) { setError(message(value)); setLoading(false) } })
    return () => { current = false }
  }, [active, api, document, projectId, attempt])
  const dirty = !!document && fields.some(field => draft[field.key] !== document.content[field.key])
  async function save(): Promise<boolean> {
    if (!api || !document || saving || loading) return false
    if (!dirty) return true
    setSaving(true); setSaved(false); setError('')
    try { const value = await api.save(projectId, draft, document.version); setDocument(value); setDraft(value.content); setSaved(true); return true }
    catch (value) { setError(message(value)); return false }
    finally { setSaving(false) }
  }
  function edit(field: keyof ReferenceContext, text: string): void { setDraft(value => ({ ...value, [field]: text })); setSaved(false) }
  function discard(): void { if (document) setDraft(document.content); setSaved(false); setError('') }
  function reload(): void { setDocument(null); setAttempt(value => value + 1); setSaved(false) }
  return { document, draft, loading, saving, error, saved, dirty, save, edit, discard, reload }
}

function ReferenceContextForm({ editor, scope }: { editor: ReturnType<typeof useContextEditor>; scope: 'Global' | 'Project' }): JSX.Element {
  const id = useId()
  const busy = editor.loading || editor.saving
  return <form className="reference-context-form" aria-label={`${scope} reference context`} aria-busy={busy} onSubmit={event => { event.preventDefault(); void editor.save() }}>
    <div className="reference-context-fields">{fields.map(field => <div key={field.key} className={`reference-context-field reference-field-${field.key}`}>
      <label htmlFor={`${id}-${field.key}`}><span>{field.label}</span><small>{editor.draft[field.key].length.toLocaleString()} / {REFERENCE_CONTEXT_LIMITS[field.key].toLocaleString()}</small></label>
      <textarea id={`${id}-${field.key}`} aria-label={`${scope} ${field.label.toLowerCase()}`} rows={field.rows} maxLength={REFERENCE_CONTEXT_LIMITS[field.key]} placeholder={field.placeholder} value={editor.draft[field.key]} disabled={busy || !editor.document} onChange={event => editor.edit(field.key, event.target.value)} />

    </div>)}</div>

    {editor.error && <div className="reference-context-error" role="alert"><p>{editor.error}</p><Button type="button" variant="ghost" disabled={busy} onClick={editor.reload}>Reload saved context</Button></div>}
    <div className="reference-context-actions"><span role="status">{editor.loading ? 'Loading context…' : editor.saved ? <><Check size={14} />Context saved</> : editor.dirty ? 'Unsaved changes' : 'Saved'}</span><div className="toolbar-actions"><Button type="button" disabled={!editor.dirty || busy} onClick={editor.discard}>Discard changes</Button><Button type="submit" variant="primary" busy={editor.saving} disabled={!editor.document || !editor.dirty || busy}>Save {scope.toLowerCase()} context</Button></div></div>
  </form>
}

export function GlobalReferenceContext(): JSX.Element | null {
  const editor = useContextEditor(null, true)
  if (!appClient.referenceContext) return null
  return <section className="settings-section global-reference-context" id="global-context" tabIndex={-1}><h2><BookOpen size={18} />Global context</h2><p>Background for summaries and Assistant across your library.</p><ReferenceContextForm editor={editor} scope="Global" /></section>
}

export function ContextDialog({ projectId, name }: { projectId: string | null; name: string }): JSX.Element | null {
  const [open, setOpen] = useState(false), [closing, setClosing] = useState(false)
  const editor = useContextEditor(projectId, open), scope = projectId ? 'Project' : 'Global'
  if (!appClient.referenceContext) return null
  function changeOpen(value: boolean): void { if (editor.saving) return; if (!value && editor.dirty) setClosing(true); else setOpen(value) }
  return <><Dialog.Root open={open} onOpenChange={changeOpen}>
    <Dialog.Trigger asChild><Button><BookOpen size={16} />{scope} context</Button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="confirmation-dialog reference-context-dialog" onInteractOutside={event => { if (editor.saving) event.preventDefault() }} onEscapeKeyDown={event => { if (editor.saving) event.preventDefault() }}>
      <div className="panel-heading"><Dialog.Title><BookOpen size={20} />{projectId ? name : 'Global'} context</Dialog.Title><Dialog.Close asChild><Button variant="ghost" aria-label={`Close ${scope.toLowerCase()} context`} disabled={editor.saving}><X size={18} /></Button></Dialog.Close></div>
      <Dialog.Description>{projectId ? 'Background for this project. Overrides matching global details.' : 'Background for summaries and Assistant across your library.'}</Dialog.Description>
      {projectId && <div className="reference-global-link"><ContextDialog projectId={null} name="Global" /></div>}
      <ReferenceContextForm editor={editor} scope={scope} />
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root><AlertDialog.Root open={closing} onOpenChange={setClosing}><AlertDialog.Portal><AlertDialog.Overlay className="dialog-overlay" /><AlertDialog.Content className="confirmation-dialog"><AlertDialog.Title>Keep your context changes?</AlertDialog.Title><AlertDialog.Description>Save the changes before closing, discard them, or continue editing.</AlertDialog.Description><div className="dialog-actions"><AlertDialog.Cancel asChild><Button disabled={editor.saving}>Keep editing</Button></AlertDialog.Cancel><Button disabled={editor.saving} onClick={() => { editor.discard(); setClosing(false); setOpen(false) }}>Discard changes</Button><Button variant="primary" busy={editor.saving} onClick={() => { void editor.save().then(saved => { if (saved) { setClosing(false); setOpen(false) } else setClosing(false) }) }}>Save and close</Button></div></AlertDialog.Content></AlertDialog.Portal></AlertDialog.Root></>
}
export function ProjectReferenceContext({ projectId, name }: { projectId: string; name: string }): JSX.Element | null { return <ContextDialog projectId={projectId} name={name} /> }
