// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { assistantNoteDocument, appendAssistantDocument } from '../assistant-note-document'
import { citationNoteLink, noteSourceRoute } from '../note-source-links'
import { MarkdownContent } from '../../components/MarkdownContent'
import { NoteDocumentView } from '../../components/NoteDocumentView'
import RichNoteEditor from '../../components/RichNoteEditor'
import { exportNoteDocument, notePlainText, validateNoteDocument } from '../../shared/note-document'
import type { NoteNode, WrittenNote } from '../../shared/notes'
import type { SourceCitation } from '../../shared/ai'

const recordingId = '11111111-1111-4111-8111-111111111111', noteId = '22222222-2222-4222-8222-222222222222', projectId = '33333333-3333-4333-8333-333333333333', origin = 'https://notes.example'
const citations: SourceCitation[] = [{ number: 1, recordingId, title: 'Pilot review', start: 74.5, excerpt: 'We approved the pilot.' }, { kind: 'note', number: 2, noteId, revision: 3, blockId: 'evidence-block', title: 'Project brief', heading: 'Budget', projectId, projectName: 'Team', excerpt: 'The budget is 120 dollars.' }]
const html = (markdown: string): string => renderToStaticMarkup(<MarkdownContent>{markdown}</MarkdownContent>)
const flatten = (node: NoteNode): NoteNode[] => [node, ...(node.content?.flatMap(flatten) ?? [])]
afterEach(cleanup)

describe('Assistant answer document conversion', () => {
  it('retains editable headings, emphasis, strike, lists, quotes, code, tables and ordinary links', () => {
    const source = '# Brief\n\n### Details\n\nUse **bold**, *italics*, ~~old wording~~ and `project_code`. [Website](https://example.com) and [relative page](/manual)\n\n- First\n  - Nested\n\n1. Ordered\n2. Second\n\n> Keep this quote.\n\n---\n\n```ts\nconst answer = 42;\nconsole.log(answer);\n```\n\n| Topic | Result |\n| --- | --- |\n| Pilot | Approved |'
    const document = assistantNoteDocument(html(source), [], origin), nodes = flatten(document)
    expect(nodes.filter(node => node.type === 'heading').map(node => node.attrs?.level)).toEqual([1, 3])
    for (const type of ['bold', 'italic', 'strike', 'code', 'link']) expect(nodes.some(node => node.marks?.some(mark => mark.type === type))).toBe(true)
    for (const type of ['bulletList', 'orderedList', 'blockquote', 'horizontalRule', 'table', 'tableRow', 'tableHeader', 'tableCell']) expect(nodes.some(node => node.type === type)).toBe(true)
    expect(nodes.find(node => node.type === 'codeBlock')).toMatchObject({ attrs: { language: 'ts' }, content: [{ text: 'const answer = 42;\nconsole.log(answer);\n' }] })
    const exported = exportNoteDocument('Answer', null, document, true)
    expect(exported).toContain('| Topic | Result |\n| --- | --- |\n| Pilot | Approved |')
    expect(exported).toContain('```ts\nconst answer = 42;\nconsole.log(answer);\n```')
    expect(exported).toContain('(https://notes.example/manual)'); expect(exported).toContain('~~old wording~~'); expect(exported).toContain('`project_code`')
  })
  it('links only real source tokens, pins written revisions and keeps excerpts even if the original disappears', () => {
    const document = assistantNoteDocument(html('Agreed **[1]** and supported by [2]. Unknown [99]. Already linked [[1]](https://elsewhere.example). Inline `[1]`.\n\n```text\n[1] is literal code\n```'), citations, origin)
    const nodes = flatten(document), linked = nodes.filter(node => node.marks?.some(mark => mark.type === 'link'))
    expect(linked.find(node => node.text === '[1]')).toMatchObject({ marks: [{ type: 'bold' }, { type: 'link', attrs: { href: origin + '/#/library/' + recordingId + '?t=74.5' } }] })
    const written = origin + '/#/notes/' + noteId + '?project=' + projectId + '&revision=3&block=evidence-block'
    expect(linked.find(node => node.text === '[2]')?.marks).toContainEqual({ type: 'link', attrs: { href: written } })
    expect(linked.some(node => node.text === '[99]')).toBe(false)
    expect(linked.filter(node => node.text === '[1]').every(node => node.marks?.some(mark => mark.attrs?.href === citationNoteLink(citations[0], origin)))).toBe(true)
    expect(nodes.find(node => node.text === '[1]' && node.marks?.some(mark => mark.type === 'code'))?.marks).not.toContainEqual(expect.objectContaining({ type: 'link' }))
    expect(nodes.find(node => node.type === 'codeBlock')?.content?.[0].text).toBe('[1] is literal code\n')
    expect(notePlainText(document)).toContain('We approved the pilot.'); expect(notePlainText(document)).toContain('The budget is 120 dollars.')
    render(<NoteDocumentView document={document} />)
    expect(screen.getByRole('link', { name: '[2]' })).toHaveAttribute('href', written)
    expect(screen.getByRole('link', { name: /Pilot review — Recording · 1:15/ })).toHaveAttribute('href', citationNoteLink(citations[0], origin))
  })
  it('preserves checked and unchecked personal checklists without creating managed tasks', () => {
    const document = assistantNoteDocument(html('- [x] Reviewed\n- [ ] Still drafting'), [], origin)
    expect(flatten(document).filter(node => node.type === 'taskItem').map(node => node.attrs?.checked)).toEqual([true, false])
    expect(exportNoteDocument('Checklist', null, document, true)).toContain('[x] Reviewed')
  })
  it('strips executable HTML and unsafe URLs while retaining visible text', () => {
    const document = assistantNoteDocument('<p style="color:red" onclick="bad()">Safe <a href="javascript:bad()">label</a><script>secret()</script><img src=x onerror=bad()></p><iframe src=x></iframe>', [], origin)
    expect(notePlainText(document)).toBe('Safe label')
    expect(JSON.stringify(document)).not.toMatch(/javascript|onclick|script|iframe|onerror|secret/)
  })
  it('rejects invalid source identities and oversized answers before a note can be changed', () => {
    expect(() => assistantNoteDocument(html('Answer [1]'), [{ ...citations[0], recordingId: '../bad' } as SourceCitation], origin)).toThrow('invalid recording source')
    expect(() => assistantNoteDocument(html('Answer [1]'), [citations[0], citations[0]], origin)).toThrow('invalid source numbers')
    expect(() => assistantNoteDocument('<p>' + 'x'.repeat(512 * 1024) + '</p>', [], origin)).toThrow('512 KiB')
  })
  it('appends after all existing content, with fresh IDs and unchanged destination metadata', () => {
    const answer = assistantNoteDocument(html('**Keep this formatting.**'), [], origin)
    const target: WrittenNote = { kind: 'note', id: noteId, title: 'Manual title', projectId, projectName: 'Team', tags: ['manual'], revision: 7, preview: '', documentSchema: 1, createdAt: '2026-11-03T18:00:00Z', updatedAt: '2026-11-03T18:00:00Z', document: structuredClone(answer), plainText: 'Keep this formatting.' }
    const before = structuredClone(target), appended = appendAssistantDocument(target, answer), ids = flatten(appended).flatMap(node => node.attrs?.id ? [node.attrs.id] : [])
    expect(target).toEqual(before); expect(appended.content.slice(0, target.document.content.length)).toEqual(target.document.content)
    expect(ids.length).toBe(new Set(ids).size); expect(notePlainText(appended).match(/Keep this formatting\./g)).toHaveLength(2)
    expect(appended.content[target.document.content.length].type).toBe('horizontalRule')
  })
  it('edits a converted answer without losing tables, code or citation identity and opens source links in-app', async () => {
    const document = assistantNoteDocument(html('### Result\n\nEvidence [1].\n\n| A | B |\n| --- | --- |\n| One | Two |\n\n```js\nlet x = 1;\n```\n\n- [ ] Review'), citations, origin), change = vi.fn(), open = vi.fn()
    const view = render(<RichNoteEditor document={document} disabled={false} onChange={change} onSourceLink={open} />)
    await screen.findByRole('heading', { level: 3, name: 'Result' })
    expect(view.container.querySelector('table td')).toHaveTextContent('One')
    expect(view.container.querySelector('pre code')).toHaveTextContent('let x = 1;')
    fireEvent.click(view.container.querySelector('input[type=checkbox]')!)
    await waitFor(() => expect(change).toHaveBeenCalled())
    const saved = validateNoteDocument(change.mock.calls.at(-1)![0])
    expect(flatten(saved).filter(node => node.type === 'tableCell')).toHaveLength(2)
    expect(flatten(saved).find(node => node.type === 'codeBlock')?.content?.[0].text).toBe('let x = 1;\n')
    fireEvent.click(screen.getByRole('link', { name: '[1]' }))
    expect(open).toHaveBeenCalledWith('/library/' + recordingId + '?t=74.5')
  })
  it('recognizes only valid internal source routes and retains public server URLs for export', () => {
    expect(noteSourceRoute(citationNoteLink(citations[1], origin))).toBe('/notes/' + noteId + '?project=' + projectId + '&revision=3&block=evidence-block')
    for (const value of ['javascript:alert(1)', 'https://example.com/page', 'https://example.com/#/settings', 'https://example.com/#/library/../private']) expect(noteSourceRoute(value)).toBeNull()
  })
})
