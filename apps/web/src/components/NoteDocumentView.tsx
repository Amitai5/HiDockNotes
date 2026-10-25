import type { ReactNode } from 'react'
import type { NoteDocument, NoteNode } from '../shared/notes'
import { safeNoteLink } from '../shared/note-document'

function render(node: NoteNode, key: string): ReactNode {
  const content = node.content?.map((child, index) => render(child, `${key}-${index}`))
  const attrs = { key, 'data-block-id': node.attrs?.id, id: node.attrs?.id ? `note-block-${node.attrs.id}` : undefined }
  switch (node.type) {
    case 'text': return (node.marks ?? []).reduce<ReactNode>((value, mark, index) => {
      const id = `${key}-mark-${index}`
      if (mark.type === 'bold') return <strong key={id}>{value}</strong>
      if (mark.type === 'italic') return <em key={id}>{value}</em>
      if (mark.type === 'underline') return <u key={id}>{value}</u>
      try { return <a key={id} href={safeNoteLink(mark.attrs?.href)} target="_blank" rel="noopener noreferrer">{value}</a> } catch { return value }
    }, node.text)
    case 'paragraph': return <p {...attrs}>{content?.length ? content : <br />}</p>
    case 'heading': return node.attrs?.level === 1 ? <h1 {...attrs}>{content}</h1> : <h2 {...attrs}>{content}</h2>
    case 'hardBreak': return <br key={key} />
    case 'bulletList': return <ul {...attrs}>{content}</ul>
    case 'orderedList': return <ol {...attrs} start={node.attrs?.start}>{content}</ol>
    case 'listItem': return <li {...attrs}>{content}</li>
    case 'taskList': return <ul {...attrs} data-type="taskList">{content}</ul>
    case 'taskItem': return <li {...attrs} data-type="taskItem" data-checked={node.attrs?.checked}><label><input type="checkbox" checked={node.attrs?.checked ?? false} readOnly disabled aria-label="Saved checklist state" /></label><div>{content}</div></li>
    case 'blockquote': return <blockquote {...attrs}>{content}</blockquote>
    default: return content
  }
}
export function NoteDocumentView({ document }: { document: NoteDocument }): JSX.Element { return <div className="note-prose note-document-view">{render(document, 'document')}</div> }
