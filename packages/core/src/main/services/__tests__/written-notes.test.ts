import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {closeDatabase,createProject,initializeDatabase,queryOne,run} from '../database'
import {WrittenNotes} from '../written-notes'
import {libraryContent} from '../library-content'
import {emptyNoteDocument,notePlainText,validateNoteDocument,exportNoteDocument,projectNoteBlocks} from '../../../shared/note-document'
import type {NoteDocument} from '../../../shared/notes'
let notes:WrittenNotes,counter:number,changed:ReturnType<typeof vi.fn>
const uuid=()=>`00000000-0000-4000-8000-${String(++counter).padStart(12,'0')}`
const doc=(text='A launch plan with Unicode café 東京'):NoteDocument=>({type:'doc',content:[{type:'heading',attrs:{id:'heading',level:1},content:[{type:'text',text:'Launch'}]},{type:'paragraph',attrs:{id:'paragraph'},content:[{type:'text',text}]}]})
beforeEach(()=>{counter=0;initializeDatabase(':memory:');changed=vi.fn();notes=new WrittenNotes({changed,id:uuid,now:()=>new Date('2026-10-23T12:00:00Z')})})
afterEach(closeDatabase)
describe('written-note persistence and contracts',()=>{
  it('normalizes creation property order and retains idempotency after its project is deleted',()=>{
    const project=createProject('Temporary'),request=uuid(),first=notes.create({requestId:request,projectId:project.id,title:'Stable',document:doc()})
    expect(notes.create({document:doc(),title:'Stable',projectId:project.id,requestId:request}).id).toBe(first.id)
    run('DELETE FROM projects WHERE id=?',[project.id]);expect(notes.create({requestId:request,projectId:project.id,title:'Stable',document:doc()})).toMatchObject({id:first.id,projectId:null})
  })
  it('duplicates a maximum-length title without exceeding the title limit',()=>{
    const source=notes.create({requestId:uuid(),projectId:null,title:'A'.repeat(300)}),copy=notes.create({requestId:uuid(),projectId:null,sourceId:source.id})
    expect(copy.title).toHaveLength(300);expect(copy.title.endsWith(' copy')).toBe(true)
  })
  it('creates a first-class note and immediately lists and searches it without audio',()=>{
    const note=notes.create({requestId:uuid(),projectId:null,title:'Preparation',document:doc(),tags:[' Product ','product']})
    expect(note).toMatchObject({title:'Preparation',revision:1,documentSchema:1,tags:['Product']});expect(note.plainText).toContain('café 東京')
    expect(queryOne('SELECT id FROM recordings')).toBeUndefined();expect(notes.list().notes).toHaveLength(1);expect(notes.list().notes[0]).not.toHaveProperty('document')
    expect(notes.search({query:'launch'}).hits[0]).toMatchObject({noteId:note.id,revision:1,blockId:'heading'})
    expect(libraryContent().items[0]).toMatchObject({kind:'note',id:note.id})
  })
  it('is idempotent for lost create and save responses and rejects reused mutation IDs with changed payloads',()=>{
    const input={requestId:uuid(),projectId:null,title:'Draft',document:doc()},first=notes.create(input)
    expect(notes.create(input).id).toBe(first.id);expect(notes.list().total).toBe(1)
    const save={title:'Changed',document:doc('The launch is Friday.'),tags:[],expectedRevision:1,mutationId:uuid()}
    expect(notes.save(first.id,save)).toMatchObject({status:'saved',note:{revision:2}});expect(notes.save(first.id,save)).toMatchObject({status:'saved',note:{revision:2}})
    expect(notes.history(first.id)).toHaveLength(2);expect(()=>notes.save(first.id,{...save,title:'Other'})).toThrow('mutation ID')
  })
  it('rejects stale saves without overwriting the accepted content or announcing a commit',()=>{
    const note=notes.create({requestId:uuid(),projectId:null,document:doc()});notes.save(note.id,{title:'Winner',document:doc('Accepted'),tags:[],expectedRevision:1,mutationId:uuid()});changed.mockClear()
    const result=notes.save(note.id,{title:'Loser',document:doc('Stale'),tags:[],expectedRevision:1,mutationId:uuid()})
    expect(result).toMatchObject({status:'conflict',current:{title:'Winner',revision:2}});expect(notes.get(note.id).plainText).toContain('Accepted');expect(changed).not.toHaveBeenCalled()
  })
  it('bounds history and supports restoring a revision as a new accepted edit',()=>{
    const note=notes.create({requestId:uuid(),projectId:null,title:'Original',document:doc()})
    let revision=1;for(let index=0;index<55;index++){notes.save(note.id,{title:'Edit '+index,document:doc('Version '+index),tags:[],expectedRevision:revision++,mutationId:uuid()})}
    expect(notes.history(note.id)).toHaveLength(50);expect(()=>notes.get(note.id,1)).toThrow('no longer available')
    expect(notes.restoreRevision(note.id,7,56,uuid())).toMatchObject({status:'saved',note:{revision:57,title:'Edit 5'}})
  })
  it('moves and duplicates notes with independent block identities, and unfiles on project deletion',()=>{
    const project=createProject('ColonyLaw'),note=notes.create({requestId:uuid(),projectId:project.id,document:doc()})
    const duplicate=notes.create({requestId:uuid(),projectId:project.id,sourceId:note.id});expect(duplicate.title).toBe(note.title+' copy');expect(projectNoteBlocks(duplicate.document)[0].id).not.toBe('heading')
    expect(notes.move(note.id,null,1,uuid())).toMatchObject({status:'saved',note:{projectId:null,revision:2}})
    run('DELETE FROM projects WHERE id=?',[project.id]);expect(notes.get(duplicate.id).projectId).toBeNull();expect(notes.list({scope:{kind:'unfiled'}}).total).toBe(2)
  })
  it('preserves original scope semantics and returns deterministic continuation pages',()=>{
    const project=createProject('Practice AI');for(let index=0;index<4;index++)notes.create({requestId:uuid(),projectId:index%2?project.id:null,title:'Note '+index})
    const page=notes.list({limit:2});expect(page.notes).toHaveLength(2);expect(page.total).toBe(4);expect(notes.list({limit:2,cursor:page.nextCursor}).notes.map(note=>note.id).some(id=>page.notes.some(note=>note.id===id))).toBe(false)
    expect(notes.list({scope:{kind:'project',projectId:project.id}}).total).toBe(2);expect(()=>notes.list({scope:{kind:'unfiled'},cursor:page.nextCursor})).toThrow('cursor')
  })
  it('pins paginated block reads to the revision actually requested',()=>{
    const long:NoteDocument={type:'doc',content:Array.from({length:5},(_,index)=>({type:'paragraph',attrs:{id:'block-'+index},content:[{type:'text',text:'Old passage '+index}]}))}
    const note=notes.create({requestId:uuid(),projectId:null,document:long}),page=notes.readPage(note.id,{limit:2})
    notes.save(note.id,{title:'Current',document:doc('Current passage'),tags:[],expectedRevision:1,mutationId:uuid()})
    const continuation=notes.readPage(note.id,{cursor:page.nextCursor,limit:2});expect(continuation.revision).toBe(1);expect(continuation.blocks[0].text).toBe('Old passage 2');expect(continuation).not.toHaveProperty('document')
  })
  it('deletes only after confirmation and revision checks and removes derived search data',()=>{
    const note=notes.create({requestId:uuid(),projectId:null,document:doc()});expect(()=>notes.remove(note.id,1,false)).toThrow('Confirm');expect(notes.remove(note.id,2,true)).toMatchObject({status:'conflict'});expect(notes.remove(note.id,1,true)).toEqual({status:'deleted'});expect(notes.remove(note.id,1,true)).toEqual({status:'deleted'});expect(notes.list().notes).toEqual([]);expect(notes.search({query:'launch'}).hits).toEqual([])
  })
})
describe('constrained rich-text documents',()=>{
  it('preserves nested lists, safe links, formatting and checkbox state through schema projection and export',()=>{
    const document:NoteDocument={type:'doc',content:[{type:'taskList',content:[{type:'taskItem',attrs:{id:'task',checked:true},content:[{type:'paragraph',attrs:{id:'task-p'},content:[{type:'text',text:'Launch brief',marks:[{type:'bold'},{type:'italic'},{type:'underline'},{type:'link',attrs:{href:'https://example.com/brief'}}]}]},{type:'orderedList',attrs:{start:3},content:[{type:'listItem',attrs:{id:'nested'},content:[{type:'paragraph',attrs:{id:'nested-p'},content:[{type:'text',text:'Follow up'}]}]}]}]}]}]}
    const parsed=validateNoteDocument(document);expect(notePlainText(parsed)).toContain('[x] Launch brief (https://example.com/brief)');expect(notePlainText(parsed)).toContain('3. Follow up');expect(projectNoteBlocks(parsed)[0].checked).toBe(true)
    const markdown=exportNoteDocument('Checklist','ColonyLaw',parsed,true);expect(markdown).toContain('[x]');expect(markdown).toContain('https://example.com/brief');expect(markdown).toContain('Project: ColonyLaw')
  })
  it.each(['javascript:alert(1)','data:text/html,script','file:///private','https://user:password@example.com','https://example.com/\nscript'])('rejects unsafe link %s',href=>{const value=doc();value.content[1].content![0].marks=[{type:'link',attrs:{href}}];expect(()=>validateNoteDocument(value)).toThrow('link')})
  it('rejects unsupported nodes, event attributes, duplicate IDs and oversized documents',()=>{
    expect(()=>validateNoteDocument({type:'doc',content:[{type:'script',text:'alert(1)'}]})).toThrow('Unsupported')
    expect(()=>validateNoteDocument({type:'doc',content:[{type:'paragraph',attrs:{id:'p',onclick:'alert(1)'}}]})).toThrow('attributes')
    const duplicate=doc();duplicate.content[1].attrs!.id='heading';expect(()=>validateNoteDocument(duplicate)).toThrow('unique')
    expect(()=>validateNoteDocument(doc('x'.repeat(512*1024)))).toThrow('512 KiB')
    expect(()=>validateNoteDocument({...emptyNoteDocument(),content:[{type:'paragraph',attrs:{id:'p'},content:Array.from({length:5001},()=>({type:'text',text:'a'}))}]})).toThrow('node limit')
  })
})
