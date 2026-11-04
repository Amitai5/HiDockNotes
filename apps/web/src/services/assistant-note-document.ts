import { randomId } from '../shared/ids'
import { generateJSON } from '@tiptap/core'
import type { SourceCitation } from '../shared/ai'
import type { NoteDocument, NoteNode, WrittenNote } from '../shared/notes'
import { duplicateNoteDocument, validateNoteDocument } from '../shared/note-document'
import { sanitizeNotePaste } from './note-paste'
import { editorNoteDocument, noteEditorExtensions } from './note-editor-schema'
import { citationNoteLink } from './note-source-links'

const block = (type: NoteNode['type'], content: NoteNode[], attributes = {}): NoteNode => ({ type, attrs: { id: randomId(), ...attributes }, content })
const words = (text: string): NoteNode => ({ type: 'text', text })
function timestamp(value: number): string { const seconds = Math.round(value); return seconds >= 3600 ? `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` }

/** Imports exactly the safe Markdown the user sees, with editable source links and saved evidence. */
export function assistantNoteDocument(html: string, citations: SourceCitation[], origin: string): NoteDocument {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  for (const anchor of parsed.body.querySelectorAll<HTMLAnchorElement>('a[href]')) { const href = anchor.getAttribute('href')!; if (href.startsWith('/') && !href.startsWith('//') || href.startsWith('#')) anchor.setAttribute('href', new URL(href, origin).href) }
  for (const checkbox of parsed.body.querySelectorAll<HTMLInputElement>('li > input[type="checkbox"]')) {
    const item = checkbox.parentElement!, list = item.parentElement
    if (list?.tagName === 'UL') { list.setAttribute('data-type', 'taskList'); item.setAttribute('data-type', 'taskItem'); item.setAttribute('data-checked', String(checkbox.checked || checkbox.hasAttribute('checked'))); checkbox.remove() }
  }
  const document = editorNoteDocument(generateJSON(sanitizeNotePaste(parsed.body.innerHTML), noteEditorExtensions()) as NoteDocument)
  const links = new Map<number, string>()
  for (const citation of citations) {
    if (!Number.isSafeInteger(citation.number) || citation.number < 1 || links.has(citation.number)) throw Error('This answer contains invalid source numbers. Its citations could not be saved.')
    links.set(citation.number, citationNoteLink(citation, origin))
  }
  const linkTokens = (node: NoteNode): void => {
    if (node.type === 'codeBlock') return
    node.content = node.content?.flatMap(child => {
      if (child.type !== 'text' || child.marks?.some(mark => mark.type === 'code')) { linkTokens(child); return [child] }
      const result: NoteNode[] = [], value = child.text!, matches = [...value.matchAll(/\[(\d+)\]/g)]; let start = 0
      for (const match of matches) {
        const href = links.get(Number(match[1])); if (!href) continue
        if (match.index! > start) result.push({ ...child, text: value.slice(start, match.index) })
        result.push({ ...child, text: match[0], marks: [...(child.marks?.filter(mark => mark.type !== 'link') ?? []), { type: 'link', attrs: { href } }] }); start = match.index! + match[0].length
      }
      if (start < value.length) result.push({ ...child, text: value.slice(start) })
      return result
    })
    if (node.content === undefined) delete node.content
  }
  linkTokens(document)
  if (citations.length) {
    document.content.push(block('heading', [words('Sources')], { level: 2 }), { type: 'bulletList', content: citations.map(citation => {
      const label = citation.kind === 'note' ? `Written note · revision ${citation.revision}` : `Recording · ${timestamp(citation.start)}`
      return block('listItem', [block('paragraph', [{ type: 'text', text: `[${citation.number}] ${citation.title} — ${label}`, marks: [{ type: 'link', attrs: { href: links.get(citation.number)! } }] }]), ...(citation.excerpt?.trim() ? [block('blockquote', [block('paragraph', [words(citation.excerpt)])])] : [])])
    }) })
  }
  return validateNoteDocument(document)
}

/** Keeps every existing block, title and tag; the server checks the destination revision. */
export function appendAssistantDocument(target: WrittenNote, answer: NoteDocument): NoteDocument {
  const fragment = duplicateNoteDocument(answer)
  return validateNoteDocument({ type: 'doc', content: [...target.document.content, { type: 'horizontalRule', attrs: { id: randomId() } }, ...fragment.content] })
}
