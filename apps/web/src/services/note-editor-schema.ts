import { randomId } from '../shared/ids'
import { Extension, Node, mergeAttributes } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Plugin } from '@tiptap/pm/state'
import { goToNextCell, tableEditing } from '@tiptap/pm/tables'
import type { NoteDocument, NoteNode } from '../shared/notes'
import { NOTE_BLOCK_TYPES, safeNoteLink, validateNoteDocument } from '../shared/note-document'

const blockTypes = new Set<string>(NOTE_BLOCK_TYPES)
const StableBlocks = Extension.create({
  name: 'stableNoteBlocks',
  addGlobalAttributes() { return [{ types: [...NOTE_BLOCK_TYPES], attributes: { id: { default: null, parseHTML: (element: HTMLElement) => element.getAttribute('data-block-id'), renderHTML: (attrs: Record<string, unknown>) => attrs.id ? { 'data-block-id': attrs.id } : {} } } }] },
  addProseMirrorPlugins() { return [new Plugin({ appendTransaction(transactions, _old, state) {
    if (!transactions.some(transaction => transaction.docChanged)) return null
    const seen = new Set<string>(), transaction = state.tr
    state.doc.descendants((node, position) => {
      if (!blockTypes.has(node.type.name)) return
      let id = node.attrs.id as string | null
      if (!id || !/^[a-zA-Z0-9_-]{1,80}$/.test(id) || seen.has(id)) { id = randomId(); transaction.setNodeMarkup(position, undefined, { ...node.attrs, id }) }
      seen.add(id)
    })
    return transaction.docChanged ? transaction.setMeta('addToHistory', false) : null
  } })] }
})
const Table = Node.create({ name: 'table', group: 'block', content: 'tableRow+', isolating: true, parseHTML: () => [{ tag: 'table' }], renderHTML: ({ HTMLAttributes }) => ['table', mergeAttributes(HTMLAttributes), ['tbody', 0]] })
const TableRow = Node.create({ name: 'tableRow', content: '(tableCell | tableHeader)+', parseHTML: () => [{ tag: 'tr' }], renderHTML: ({ HTMLAttributes }) => ['tr', HTMLAttributes, 0] })
const TableCell = Node.create({
  name: 'tableCell', content: 'block+', isolating: true,
  addAttributes() { return { colspan: { default: 1 }, rowspan: { default: 1 }, colwidth: { default: null } } },
  parseHTML: () => [{ tag: 'td' }], renderHTML: ({ HTMLAttributes }) => ['td', HTMLAttributes, 0]
})
const TableHeader = TableCell.extend({ name: 'tableHeader', parseHTML: () => [{ tag: 'th' }], renderHTML: ({ HTMLAttributes }) => ['th', HTMLAttributes, 0] })
const Tables = Extension.create({
  name: 'noteTables',
  extendNodeSchema(extension) { const roles: Record<string, string> = { table: 'table', tableRow: 'row', tableCell: 'cell', tableHeader: 'header_cell' }; return roles[extension.name] ? { tableRole: roles[extension.name] } : {} },
  addProseMirrorPlugins() { return [tableEditing()] },
  addKeyboardShortcuts() { return { Tab: () => goToNextCell(1)(this.editor.state, this.editor.view.dispatch), 'Shift-Tab': () => goToNextCell(-1)(this.editor.state, this.editor.view.dispatch) } }
})

/** Shared by answer import and the editor so saved content keeps the same formatting. */
export function noteEditorExtensions() {
  return [StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5, 6] }, trailingNode: false, link: { openOnClick: false, autolink: false, defaultProtocol: 'https', HTMLAttributes: { tabindex: '0' }, isAllowedUri: value => { try { safeNoteLink(value); return true } catch { return false } } } }), TaskList, TaskItem.configure({ nested: true }), Table, TableRow, TableCell, TableHeader, Tables, StableBlocks]
}

/** Keeps only persisted attributes and assigns IDs to newly imported blocks. */
export function editorNoteDocument(value: NoteNode): NoteDocument {
  const walk = (node: NoteNode): NoteNode => {
    const attrs = node.attrs
    return { type: node.type, ...(node.text !== undefined ? { text: node.text } : {}), ...(blockTypes.has(node.type) ? { attrs: { id: attrs?.id ?? randomId(), ...(node.type === 'heading' ? { level: attrs?.level } : node.type === 'taskItem' ? { checked: attrs?.checked ?? false } : node.type === 'codeBlock' && attrs?.language ? { language: attrs.language } : {}) } } : node.type === 'orderedList' ? { attrs: { start: attrs?.start ?? 1 } } : {}), ...(node.marks?.length ? { marks: node.marks.map(mark => mark.type === 'link' ? { type: 'link' as const, attrs: { href: mark.attrs?.href } } : { type: mark.type }) } : {}), ...(node.content ? { content: node.content.map(walk) } : node.type === 'paragraph' || node.type === 'heading' || node.type === 'codeBlock' ? { content: [] } : {}) }
  }
  return validateNoteDocument(walk(value))
}
