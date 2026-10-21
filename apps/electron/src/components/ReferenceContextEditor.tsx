import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useId, useState } from 'react'
import { BookOpen, Check, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { EMPTY_REFERENCE_CONTEXT, REFERENCE_CONTEXT_LIMITS, type ReferenceContext, type ReferenceContextDocument } from '../shared/reference-context'
import { Button } from './ui'

const fields = [
  { key: 'background', label: 'Background', help: 'Purpose, clients, organizations, and useful background.', placeholder: 'What should the AI know to understand these recordings?', rows: 3 },
  { key: 'people', label: 'People & organizations', help: 'Approved names, roles, and organization spellings. This does not identify speakers or prove attendance.', placeholder: 'Full name — role or organization\nOrganization — relevant background', rows: 4 },
  { key: 'terminology', label: 'Terminology & spellings', help: 'Acronyms, product names, specialist terms, and their preferred spellings.', placeholder: 'Acronym — meaning\nProduct or term — preferred spelling', rows: 4 }
] as const

function message(value: unknown): string { return value instanceof Error ? value.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'The reference context could not be saved. Try again.' }

function useContextEditor(projectId: string | null, active: boolean) {
  const api = window.electronAPI.referenceContext
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
  async function save(): Promise<void> {
    if (!api || !document || !dirty || saving || loading) return
    setSaving(true); setSaved(false); setError('')
    try { const value = await api.save(projectId, draft, document.version); setDocument(value); setDraft(value.content); setSaved(true) }
    catch (value) { setError(message(value)) }
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
      <textarea id={`${id}-${field.key}`} aria-label={`${scope} ${field.label.toLowerCase()}`} aria-describedby={`${id}-${field.key}-help`} rows={field.rows} maxLength={REFERENCE_CONTEXT_LIMITS[field.key]} placeholder={field.placeholder} value={editor.draft[field.key]} disabled={busy || !editor.document} onChange={event => editor.edit(field.key, event.target.value)} />
      <small id={`${id}-${field.key}-help`}>{field.help}</small>
    </div>)}</div>
    <p className="reference-context-note">Used as background for summaries and Assistant, never as evidence of what happened in a meeting. Transcripts and speaker labels stay as recorded. To update existing notes, resummarize that recording.</p>
    {editor.error && <div className="reference-context-error" role="alert"><p>{editor.error}</p><Button type="button" variant="ghost" disabled={busy} onClick={editor.reload}>Reload saved context</Button></div>}
    <div className="reference-context-actions"><span role="status">{editor.loading ? 'Loading context…' : editor.saved ? <><Check size={14} />Context saved</> : editor.dirty ? 'Unsaved changes' : 'Saved locally · shared with your selected AI provider when used'}</span><div className="toolbar-actions"><Button type="button" disabled={!editor.dirty || busy} onClick={editor.discard}>Discard changes</Button><Button type="submit" variant="primary" busy={editor.saving} disabled={!editor.document || !editor.dirty || busy}>Save {scope.toLowerCase()} context</Button></div></div>
  </form>
}

export function GlobalReferenceContext(): JSX.Element | null {
  const editor = useContextEditor(null, true)
  if (!window.electronAPI.referenceContext) return null
  return <section className="settings-section global-reference-context" id="global-context" tabIndex={-1}><h2><BookOpen size={18} />Global context</h2><p>Shared background for every project and unfiled recording. Add project-specific details from that folder in Library.</p><ReferenceContextForm editor={editor} scope="Global" /></section>
}

export function ProjectReferenceContext({ projectId, name }: { projectId: string; name: string }): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const editor = useContextEditor(projectId, open)
  if (!window.electronAPI.referenceContext) return null
  return <Dialog.Root open={open} onOpenChange={value => { if (!editor.saving) setOpen(value) }}>
    <Dialog.Trigger asChild><Button><BookOpen size={16} />Project context</Button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="confirmation-dialog reference-context-dialog" onInteractOutside={event => { if (editor.dirty || editor.saving) event.preventDefault() }} onEscapeKeyDown={event => { if (editor.saving) event.preventDefault() }}>
      <div className="panel-heading"><Dialog.Title><BookOpen size={20} />{name} context</Dialog.Title><Dialog.Close asChild><Button variant="ghost" aria-label="Close project context" disabled={editor.saving}><X size={18} /></Button></Dialog.Close></div>
      <Dialog.Description>Reference details for this project. These add to your global context and take precedence within this folder.</Dialog.Description>
      <Link className="reference-global-link" to="/settings?tab=general&focus=global-context">Edit global context<small>Applies to all projects and unfiled recordings</small></Link>
      <ReferenceContextForm editor={editor} scope="Project" />
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>
}
