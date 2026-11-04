import { createElement, type ReactNode } from 'react'
import type { NoteDocument, NoteNode } from '../shared/notes'
import { safeNoteLink } from '../shared/note-document'
import { noteSourceRoute } from '../services/note-source-links'

function render(node: NoteNode, key: string, onSourceLink?: (route: string) => void): ReactNode {
  const content = node.content?.map((child, index) => render(child, `${key}-${index}`, onSourceLink))
  const attrs = { key, 'data-block-id': node.attrs?.id, id: node.attrs?.id ? `note-block-${node.attrs.id}` : undefined }
  switch (node.type) {
    case 'text': return (node.marks ?? []).reduce<ReactNode>((value, mark, index) => {
      const id = `${key}-mark-${index}`
      if (mark.type === 'bold') return <strong key={id}>{value}</strong>
      if (mark.type === 'italic') return <em key={id}>{value}</em>
      if (mark.type === 'underline') return <u key={id}>{value}</u>
      if (mark.type === 'strike') return <s key={id}>{value}</s>
      if (mark.type === 'code') return <code key={id}>{value}</code>
      try { const href = safeNoteLink(mark.attrs?.href), route = noteSourceRoute(href); return <a key={id} href={href} target="_blank" rel="noopener noreferrer" onClick={event => { if (route && onSourceLink && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onSourceLink(route) } }}>{value}</a> } catch { return value }
    }, node.text)
    case 'paragraph': return <p {...attrs}>{content?.length ? content : <br />}</p>
    case 'heading': return createElement(`h${node.attrs?.level ?? 2}`, attrs, content)
    case 'hardBreak': return <br key={key} />
    case 'horizontalRule': return <hr {...attrs} />
    case 'codeBlock': return <pre {...attrs}><code className={node.attrs?.language ? `language-${node.attrs.language}` : undefined}>{content}</code></pre>
    case 'bulletList': return <ul {...attrs}>{content}</ul>
    case 'orderedList': return <ol {...attrs} start={node.attrs?.start}>{content}</ol>
    case 'listItem': return <li {...attrs}>{content}</li>
    case 'taskList': return <ul {...attrs} data-type="taskList">{content}</ul>
    case 'taskItem': return <li {...attrs} data-type="taskItem" data-checked={node.attrs?.checked}><label><input type="checkbox" checked={node.attrs?.checked ?? false} readOnly disabled aria-label="Saved checklist state" /></label><div>{content}</div></li>
    case 'blockquote': return <blockquote {...attrs}>{content}</blockquote>
    case 'table': return <table {...attrs}><tbody>{content}</tbody></table>
    case 'tableRow': return <tr {...attrs}>{content}</tr>
    case 'tableCell': return <td {...attrs}>{content}</td>
    case 'tableHeader': return <th {...attrs}>{content}</th>
    default: return content
  }
}
export function NoteDocumentView({ document, onSourceLink }: { document: NoteDocument; onSourceLink?: (route: string) => void }): JSX.Element { return <div className="note-prose note-document-view">{render(document, 'document', onSourceLink)}</div> }
