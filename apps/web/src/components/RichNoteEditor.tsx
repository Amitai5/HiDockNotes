import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Extension } from '@tiptap/core'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Plugin } from '@tiptap/pm/state'
import { Bold, Italic, Underline, Link as LinkIcon, List, ListOrdered, CheckSquare, Quote, Undo2, Redo2, X } from 'lucide-react'
import type { NoteDocument, NoteNode } from '../shared/notes'
import { safeNoteLink } from '../shared/note-document'
import { sanitizeNotePaste } from '../services/note-paste'
import { Button } from './ui'

const blockTypes = ['paragraph', 'heading', 'listItem', 'taskItem', 'blockquote']
const StableBlocks = Extension.create({
  name: 'stableNoteBlocks',
  addGlobalAttributes() { return [{ types: blockTypes, attributes: { id: { default: null, parseHTML: (element: HTMLElement) => element.getAttribute('data-block-id'), renderHTML: (attrs: Record<string, unknown>) => attrs.id ? { 'data-block-id': attrs.id } : {} } } }] },
  addProseMirrorPlugins() { return [new Plugin({ appendTransaction(transactions, _old, state) {
    if (!transactions.some(transaction => transaction.docChanged)) return null
    const seen = new Set<string>(), transaction = state.tr
    state.doc.descendants((node, position) => {
      if (!blockTypes.includes(node.type.name)) return
      let id = node.attrs.id as string | null
      if (!id || !/^[a-zA-Z0-9_-]{1,80}$/.test(id) || seen.has(id)) { id = crypto.randomUUID(); transaction.setNodeMarkup(position, undefined, { ...node.attrs, id }) }
      seen.add(id)
    })
    return transaction.docChanged ? transaction.setMeta('addToHistory', false) : null
  } })] }
})

// Keep the persisted schema independent of editor-library default attributes.
function documentValue(value: NoteNode): NoteDocument {
  const walk = (node: NoteNode): NoteNode => {
    const attrs = node.attrs
    return { type: node.type, ...(node.text !== undefined ? { text: node.text } : {}), ...(blockTypes.includes(node.type) ? { attrs: { id: attrs?.id, ...(node.type === 'heading' ? { level: attrs?.level } : node.type === 'taskItem' ? { checked: attrs?.checked ?? false } : {}) } } : node.type === 'orderedList' ? { attrs: { start: attrs?.start ?? 1 } } : {}), ...(node.marks?.length ? { marks: node.marks.map(mark => mark.type === 'link' ? { type: 'link' as const, attrs: { href: mark.attrs?.href } } : { type: mark.type }) } : {}), ...(node.content ? { content: node.content.map(walk) } : node.type === 'paragraph' || node.type === 'heading' ? { content: [] } : {}) }
  }
  return walk(value) as NoteDocument
}
export default function RichNoteEditor({ document, disabled, onChange, beforeContent }: { document: NoteDocument; disabled: boolean; onChange(document: NoteDocument): void; beforeContent?: ReactNode }): JSX.Element {
  const change = useRef(onChange); change.current = onChange
  const [linkOpen, setLinkOpen] = useState(false), [href, setHref] = useState(''), [error, setError] = useState('')
  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: { levels: [1, 2] }, code: false, codeBlock: false, horizontalRule: false, strike: false, trailingNode: false, link: { openOnClick: false, autolink: false, defaultProtocol: 'https', isAllowedUri: value => { try { safeNoteLink(value); return true } catch { return false } } } }), TaskList, TaskItem.configure({ nested: true }), StableBlocks],
    content: document, editable: !disabled, shouldRerenderOnTransaction: false,
    editorProps: { attributes: { class: 'note-prose', role: 'textbox', 'aria-label': 'Note body', 'aria-multiline': 'true', spellcheck: 'true' }, transformPastedHTML: html => sanitizeNotePaste(html) },
    onUpdate: ({ editor: current }) => change.current(documentValue(current.getJSON() as NoteDocument))
  })
  const state = useEditorState({ editor, selector: ({ editor: current }) => current ? { bold: current.isActive('bold'), italic: current.isActive('italic'), underline: current.isActive('underline'), link: current.isActive('link'), bullet: current.isActive('bulletList'), ordered: current.isActive('orderedList'), task: current.isActive('taskList'), quote: current.isActive('blockquote'), heading: current.isActive('heading', { level: 1 }) ? 'h1' : current.isActive('heading', { level: 2 }) ? 'h2' : 'p', undo: current.can().undo(), redo: current.can().redo() } : null })
  useEffect(() => { editor?.setEditable(!disabled, false) }, [editor, disabled])
  useEffect(() => { if (editor && JSON.stringify(documentValue(editor.getJSON() as NoteDocument)) !== JSON.stringify(document)) editor.commands.setContent(document, { emitUpdate: false }) }, [editor, document])
  return <div className="rich-note-editor" onKeyDown={event => { if (!disabled && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setHref(editor?.getAttributes('link').href ?? ''); setError(''); setLinkOpen(true) } }}><div className="note-format-toolbar" role="toolbar" aria-label="Note formatting">
    <button type="button" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={disabled || !state?.undo} onClick={() => editor?.chain().focus().undo().run()}><Undo2 size={17} /></button><button type="button" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={disabled || !state?.redo} onClick={() => editor?.chain().focus().redo().run()}><Redo2 size={17} /></button><span className="toolbar-divider" />
    <select aria-label="Text style" value={state?.heading ?? 'p'} disabled={disabled} onChange={event => { if (event.target.value === 'p') editor?.chain().focus().setParagraph().run(); else editor?.chain().focus().setHeading({ level: event.target.value === 'h1' ? 1 : 2 }).run() }}><option value="p">Text</option><option value="h1">Heading 1</option><option value="h2">Heading 2</option></select><span className="toolbar-divider" />
    <button type="button" aria-label="Bold" title="Bold (Ctrl+B)" aria-pressed={state?.bold ?? false} disabled={disabled} onClick={() => editor?.chain().focus().toggleBold().run()}><Bold size={17} /></button><button type="button" aria-label="Italic" title="Italic (Ctrl+I)" aria-pressed={state?.italic ?? false} disabled={disabled} onClick={() => editor?.chain().focus().toggleItalic().run()}><Italic size={17} /></button><button type="button" aria-label="Underline" title="Underline (Ctrl+U)" aria-pressed={state?.underline ?? false} disabled={disabled} onClick={() => editor?.chain().focus().toggleUnderline().run()}><Underline size={17} /></button>
    <Dialog.Root open={linkOpen} onOpenChange={setLinkOpen}><Dialog.Trigger asChild><button type="button" aria-label="Link" title="Add or edit link" aria-pressed={state?.link ?? false} disabled={disabled} onClick={() => { setHref(editor?.getAttributes('link').href ?? ''); setError('') }}><LinkIcon size={17} /></button></Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="confirmation-dialog"><div className="panel-heading"><Dialog.Title>Link</Dialog.Title><Dialog.Close asChild><Button variant="ghost" aria-label="Close link"><X size={18} /></Button></Dialog.Close></div><Dialog.Description>Use a complete http, https, or mailto address.</Dialog.Description><form onSubmit={event => { event.preventDefault(); try { const url = safeNoteLink(href.trim()); editor?.chain().focus().extendMarkRange('link').setLink({ href: url }).run(); setLinkOpen(false) } catch (value) { setError((value as Error).message) } }}><label className="note-field">Address<input aria-label="Link address" value={href} maxLength={2048} onChange={event => setHref(event.target.value)} /></label>{error && <p role="alert">{error}</p>}<div className="dialog-actions"><Button type="button" onClick={() => { editor?.chain().focus().extendMarkRange('link').unsetLink().run(); setLinkOpen(false) }}>Remove link</Button><Button type="submit" variant="primary">Apply link</Button></div></form></Dialog.Content></Dialog.Portal></Dialog.Root>
    <span className="toolbar-divider" /><button type="button" aria-label="Bulleted list" aria-pressed={state?.bullet ?? false} disabled={disabled} onClick={() => editor?.chain().focus().toggleBulletList().run()}><List size={18} /></button><button type="button" aria-label="Numbered list" aria-pressed={state?.ordered ?? false} disabled={disabled} onClick={() => editor?.chain().focus().toggleOrderedList().run()}><ListOrdered size={18} /></button><button type="button" aria-label="Checklist" aria-pressed={state?.task ?? false} disabled={disabled} onClick={() => editor?.chain().focus().toggleTaskList().run()}><CheckSquare size={18} /></button><button type="button" aria-label="Blockquote" aria-pressed={state?.quote ?? false} disabled={disabled} onClick={() => editor?.chain().focus().toggleBlockquote().run()}><Quote size={17} /></button>
  </div><div className="note-paper">{beforeContent}<EditorContent editor={editor} /></div></div>
}
