import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { closeDatabase, getDatabase, initializeDatabase, queryOne } from '../services/database'
import { WrittenNotes } from '../services/written-notes'
import { LibraryBackupService } from '../services/library-backup'
import { LibraryRestoreService, applyPendingRestore } from '../services/library-restore'
import { exportNoteDocument, notePlainText, projectNoteBlocks, validateNoteDocument } from '../../../src/shared/note-document'
import type { NoteDocument, NoteNode } from '../../../src/shared/notes'

let folder: string, data: string, notes: WrittenNotes, backups: LibraryBackupService, restore: LibraryRestoreService
const words = (text: string): NoteNode => ({ type: 'text', text })
const paragraph = (id: string, text: string): NoteNode => ({ type: 'paragraph', attrs: { id }, content: [words(text)] })
const rich = (): NoteDocument => ({ type: 'doc', content: [
  { type: 'heading', attrs: { id: 'heading', level: 3 }, content: [words('Saved answer')] },
  { type: 'paragraph', attrs: { id: 'citation' }, content: [{ type: 'text', text: '[1]', marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://notes.example/#/library/11111111-1111-4111-8111-111111111111?t=12' } }] }] },
  { type: 'table', attrs: { id: 'table' }, content: [
    { type: 'tableRow', attrs: { id: 'headers' }, content: [{ type: 'tableHeader', attrs: { id: 'header-a' }, content: [paragraph('title-a', 'Topic')] }, { type: 'tableHeader', attrs: { id: 'header-b' }, content: [paragraph('title-b', 'Result')] }] },
    { type: 'tableRow', attrs: { id: 'values' }, content: [{ type: 'tableCell', attrs: { id: 'cell-a' }, content: [paragraph('value-a', 'Pilot')] }, { type: 'tableCell', attrs: { id: 'cell-b' }, content: [paragraph('value-b', 'Approved')] }] }
  ] },
  { type: 'codeBlock', attrs: { id: 'code', language: 'js' }, content: [words('const value = 42;\nconsole.log(value);')] },
  { type: 'blockquote', attrs: { id: 'quote' }, content: [paragraph('quoted', 'Original saved source excerpt.')] },
  { type: 'horizontalRule', attrs: { id: 'rule' } }
] })
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'hidock-answer-notes-')); data = join(folder, 'app'); initializeDatabase(join(data, 'data/library.db'))
  notes = new WrittenNotes({ changed: () => undefined }); backups = new LibraryBackupService({ dataPath: data, database: getDatabase, version: '0.17.0', changed: () => undefined }); restore = new LibraryRestoreService({ dataPath: data, changed: () => undefined })
})
afterEach(async () => { await restore.stop(); await backups.stop(); closeDatabase(); await rm(folder, { recursive: true, force: true }) })

describe('saved Assistant answer rich text', () => {
  it('stores editable code and tables with searchable text, citation links and valid Markdown exports', () => {
    const note = notes.create({ requestId: '22222222-2222-4222-8222-222222222222', projectId: null, title: 'Answer', document: rich(), tags: ['research'] })
    expect(notes.get(note.id).document).toEqual(rich())
    expect(notes.search({ query: 'Approved' }).hits[0]).toMatchObject({ noteId: note.id, blockId: 'values' })
    expect(projectNoteBlocks(note.document).find(block => block.id === 'code')?.text).toBe('const value = 42;\nconsole.log(value);')
    expect(notes.export(note.id, 'markdown').text).toContain('| Topic | Result |\n| --- | --- |\n| Pilot | Approved |')
    expect(notes.export(note.id, 'markdown').text).toContain('```js\nconst value = 42;\nconsole.log(value);\n```')
    expect(notes.export(note.id, 'text').text).toContain('https://notes.example/#/library/')
  })
  it('rejects a save from an older cached editor before it can drop rich formatting', () => {
    const note = notes.create({ requestId: '22222222-2222-4222-8222-222222222222', projectId: null, title: 'Answer', document: rich() })
    const input = { title: note.title, tags: [], document: { type: 'doc' as const, content: [paragraph('old-editor', 'An older editor dropped the table.')] }, expectedRevision: 1, mutationId: '33333333-3333-4333-8333-333333333333' }
    expect(() => notes.save(note.id, input)).toThrow('Update app before editing this note')
    expect(notes.get(note.id).document).toEqual(rich()); expect(notes.get(note.id).revision).toBe(1)
    expect(notes.save(note.id, { ...input, formatVersion: 2 }).status).toBe('saved')
  })
  it('round-trips formatting, source links and prior revisions through a complete backup and restore', async () => {
    const note = notes.create({ requestId: '22222222-2222-4222-8222-222222222222', projectId: null, title: 'Answer', document: rich(), tags: ['research'] })
    const updated = structuredClone(note.document); updated.content.push(paragraph('follow-up', 'Added manually after saving.'))
    notes.save(note.id, { formatVersion: 2, title: 'My edited title', tags: note.tags, document: updated, expectedRevision: 1, mutationId: '33333333-3333-4333-8333-333333333333' })
    const archive = join(folder, 'library.tar.gz'); await backups.create(archive); notes.remove(note.id, 2, true)
    const preview = await restore.prepare(archive); expect(preview?.writtenNotes).toBe(1); await restore.schedule(preview!.id); closeDatabase()
    expect(applyPendingRestore(data)).toBe(true); initializeDatabase(join(data, 'data/library.db'))
    const restored = new WrittenNotes({ changed: () => undefined })
    expect(restored.get(note.id)).toMatchObject({ title: 'My edited title', tags: ['research'], revision: 2, document: updated })
    expect(restored.get(note.id, 1).document).toEqual(rich()); expect(restored.history(note.id)).toHaveLength(2)
  })
  it('upgrades schema 17 without rewriting existing note content or history', () => {
    const note = notes.create({ requestId: '22222222-2222-4222-8222-222222222222', projectId: null, title: 'Existing note', document: { type: 'doc', content: [paragraph('original', 'Original words.')] } })
    const before = queryOne('SELECT document_json,plain_text,revision FROM written_notes WHERE id=?', [note.id])
    getDatabase().pragma('user_version=17'); closeDatabase(); initializeDatabase(join(data, 'data/library.db'))
    expect(getDatabase().pragma('user_version', { simple: true })).toBe(18)
    expect(queryOne('SELECT document_json,plain_text,revision FROM written_notes WHERE id=?', [note.id])).toEqual(before)
    expect(notes.history(note.id)).toHaveLength(1)
  })
  it('exports long code exactly, choosing fences longer than any code backticks', () => {
    const code = 'a'.repeat(7000) + '\n```literal fence\n' + 'b'.repeat(5000), document: NoteDocument = { type: 'doc', content: [{ type: 'codeBlock', attrs: { id: 'long-code', language: 'text' }, content: [words(code)] }] }
    const exported = exportNoteDocument('Code', null, document, true)
    expect(exported).toContain('````text\n' + code + '\n````')
    expect(projectNoteBlocks(document).every(block => block.text.length <= 4000)).toBe(true)
    expect(notePlainText(document)).toContain('literal fence')
  })
  it('rejects executable attributes, nonrectangular tables, excessive columns and formatted code blocks', () => {
    const attributes = rich(); attributes.content[2].content![0].content![0].attrs = { ...attributes.content[2].content![0].content![0].attrs, onclick: 'bad' } as NoteNode['attrs']
    expect(() => validateNoteDocument(attributes)).toThrow('attributes')
    const ragged = rich(); ragged.content[2].content![1].content!.pop(); expect(() => validateNoteDocument(ragged)).toThrow('rectangular')
    const wide = rich(); wide.content[2].content![0].content = Array.from({ length: 21 }, (_, index) => ({ type: 'tableCell', attrs: { id: 'wide-' + index }, content: [paragraph('p-' + index, 'cell')] })); expect(() => validateNoteDocument(wide)).toThrow('20 columns')
    const invalidCode = rich(); invalidCode.content[3].content![0].marks = [{ type: 'bold' }]; expect(() => validateNoteDocument(invalidCode)).toThrow('Code blocks')
    const language = rich(); language.content[3].attrs!.language = '"><script>'; expect(() => validateNoteDocument(language)).toThrow('code language')
  })
})
