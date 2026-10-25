import { createHash, randomUUID } from 'node:crypto'
import type { LibraryScope, NoteCreate, NoteListOptions, NoteMutationResult, NotePage, NoteReadPage, NoteSave, NoteSearchOptions, NoteSearchPage, NoteRevision, WrittenNote, WrittenNoteView } from '../../../src/shared/notes'
import { duplicateNoteDocument, emptyNoteDocument, exportNoteDocument, NOTE_LIMITS, notePlainText, projectNoteBlocks, validateNoteDocument } from '../../../src/shared/note-document'
import { queryAll, queryOne, run, runInTransaction } from './database'
import { validateId } from '../ipc/jensen-validation'

interface NoteRow { id:string; project_id:string|null; project_name:string|null; title:string; document_json:string; plain_text:string; document_schema:number; revision:number; created_at:string; updated_at:string; tags:string }
interface Dependencies { changed(event:{id:string;deleted?:boolean}):void; now?:()=>Date; id?:()=>string }
const SELECT="SELECT n.*,p.name AS project_name,COALESCE((SELECT json_group_array(tag) FROM (SELECT tag FROM written_note_tags WHERE note_id=n.id ORDER BY tag)),'[]') AS tags FROM written_notes n LEFT JOIN projects p ON p.id=n.project_id"
function integer(value:unknown,min:number,max=Number.MAX_SAFE_INTEGER):number { if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)throw Error('Invalid note revision or page size.');return value }
function requestId(value:unknown):string { const id=validateId(value);if(!/^[0-9a-f-]{36}$/i.test(id))throw Error('Use a unique request ID for this note change.');return id }
function title(value:unknown):string { if(typeof value!=='string'||value.length>NOTE_LIMITS.title||/[\x00-\x1f]/.test(value))throw Error('Use a title of up to 300 characters.');return value.trim()||'Untitled note' }
function tags(value:unknown):string[] { if(!Array.isArray(value)||value.length>20||value.some(tag=>typeof tag!=='string'||!tag.trim()||tag.trim().length>40||/[\x00-\x1f]/.test(tag)))throw Error('Use at most 20 tags of 40 characters.');const seen=new Set<string>();return value.map(tag=>tag.trim()).filter(tag=>{const key=tag.toLocaleLowerCase();if(seen.has(key))return false;seen.add(key);return true}) }
export function validateLibraryScope(value:unknown):LibraryScope {
  if(value===undefined)return{kind:'all'}
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid library scope.')
  const scope=value as Record<string,unknown>
  if(scope.kind==='all'||scope.kind==='unfiled'){if(Object.keys(scope).length!==1)throw Error('Invalid library scope.');return{kind:scope.kind}}
  if(scope.kind==='project'&&Object.keys(scope).length===2)return{kind:'project',projectId:validateId(scope.projectId)}
  throw Error('Invalid library scope.')
}
export function scopeWhere(scope:LibraryScope,alias:string,parameters:unknown[]):string { if(scope.kind==='all')return'';if(scope.kind==='unfiled')return' AND '+alias+'.project_id IS NULL';parameters.push(scope.projectId);return' AND '+alias+'.project_id=?' }
export function keywordMatch(query:string):string { return [...new Set(query.match(/[\p{L}\p{N}_-]+/gu)??[])].slice(0,30).map(term=>'"'+term.replaceAll('"','""')+'"*').join(' OR ') }
export function pageOffset(cursor:unknown,identity:unknown):number { if(cursor==null)return 0;if(typeof cursor!=='string'||cursor.length>1000)throw Error('Invalid continuation cursor.');try{const value=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));if(value.key!==createHash('sha256').update(JSON.stringify(identity)).digest('hex'))throw Error();return integer(value.offset,0,10000000)}catch{throw Error('Invalid continuation cursor. Start a fresh scan.')} }
export function pageCursor(offset:number,identity:unknown):string { return Buffer.from(JSON.stringify({offset,key:createHash('sha256').update(JSON.stringify(identity)).digest('hex')})).toString('base64url') }
function project(value:unknown):string|null { if(value===null)return null;const id=validateId(value);if(!queryOne('SELECT id FROM projects WHERE id=?',[id]))throw Error('The destination project no longer exists. Choose another project.');return id }
function metadata(row:NoteRow):WrittenNoteView { return{kind:'note',id:row.id,title:row.title,projectId:row.project_id,projectName:row.project_name,revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at,preview:row.plain_text.slice(0,300),tags:JSON.parse(row.tags) as string[]} }
function document(row:NoteRow):WrittenNote { if(row.document_schema!==1)throw Error('This note needs a newer document reader.');return{...metadata(row),document:validateNoteDocument(JSON.parse(row.document_json)),documentSchema:1,plainText:row.plain_text} }

/** Durable note changes, FTS updates and revision history commit in one transaction. */
export class WrittenNotes {
  constructor(private readonly dependencies:Dependencies){}
  list(options:NoteListOptions={}):NotePage {
    const scope=validateLibraryScope(options.scope),query=options.query??'',limit=integer(options.limit??30,1,50),identity=['notes',scope,query],offset=pageOffset(options.cursor,identity)
    if(typeof query!=='string'||query.length>500)throw Error('Use a search of up to 500 characters.')
    const parameters:unknown[]=[],where=' WHERE 1=1'+scopeWhere(scope,'n',parameters)+(query.trim()?' AND n.id IN (SELECT note_id FROM written_note_fts WHERE written_note_fts MATCH ?)':'')
    if(query.trim()){const match=keywordMatch(query);if(!match)return{notes:[],total:0,nextCursor:null,consistency:'live'};parameters.push(match)}
    const count=queryOne<{count:number}>('SELECT count(*) AS count FROM written_notes n'+where,parameters)!.count
    const rows=queryAll<NoteRow>(SELECT.replace('n.*,','n.id,n.project_id,n.title,substr(n.plain_text,1,300) AS plain_text,n.revision,n.created_at,n.updated_at,')+where+' ORDER BY n.created_at DESC,n.id LIMIT ? OFFSET ?',[...parameters,limit+1,offset])
    return{notes:rows.slice(0,limit).map(metadata),nextCursor:rows.length>limit?pageCursor(offset+limit,identity):null,total:count,consistency:'live'}
  }
  get(id:string,revision?:number):WrittenNote {
    validateId(id)
    const row=queryOne<NoteRow>(SELECT+' WHERE n.id=?',[id]);if(!row)throw Error('Written note was not found.')
    if(revision===undefined||integer(revision,1)===row.revision)return document(row)
    const saved=queryOne<{snapshot_json:string}>('SELECT snapshot_json FROM written_note_versions WHERE note_id=? AND revision=?',[id,revision])
    if(!saved)throw Error('This note revision is no longer available. Start a fresh read; saved citation excerpts remain available.')
    const note=JSON.parse(saved.snapshot_json) as WrittenNote;note.document=validateNoteDocument(note.document);return note
  }
  create(input:NoteCreate):WrittenNote {
    const key=requestId(input.requestId)
    const hash=createHash('sha256').update(JSON.stringify({projectId:input.projectId,sourceId:input.sourceId??null,title:input.title===undefined?null:title(input.title),document:input.document===undefined?null:validateNoteDocument(input.document),tags:input.tags===undefined?null:tags(input.tags)})).digest('hex')
    const previous=queryOne<{id:string;create_hash:string}>('SELECT id,create_hash FROM written_notes WHERE client_request_id=?',[key])
    if(previous){if(previous.create_hash!==hash)throw Error('This creation request was already used for different content.');return this.get(previous.id)}
    const destination=project(input.projectId),source=input.sourceId?this.get(validateId(input.sourceId)):null,id=this.dependencies.id?.()??randomUUID(),now=(this.dependencies.now?.()??new Date()).toISOString()
    const content=source?duplicateNoteDocument(source.document):validateNoteDocument(input.document??emptyNoteDocument()),name=title(input.title??(source?source.title.slice(0,295)+' copy':'Untitled note')),labels=tags(input.tags??source?.tags??[])
    runInTransaction(()=>{run('INSERT INTO written_notes(id,project_id,title,document_json,plain_text,document_schema,revision,client_request_id,create_hash,created_at,updated_at) VALUES (?,?,?,?,?,1,1,?,?,?,?)',[id,destination,name,JSON.stringify(content),notePlainText(content),key,hash,now,now]);this.saveTags(id,labels);this.snapshot(id)})
    this.dependencies.changed({id});return this.get(id)
  }
  save(id:string,input:NoteSave):NoteMutationResult { return this.change(id,input) }
  move(id:string,projectId:string|null,expectedRevision:number,mutationId:string):NoteMutationResult {
    const current=this.get(id)
    return this.change(id,{title:current.title,document:current.document,tags:current.tags,expectedRevision,mutationId},project(projectId),{kind:'move',projectId,expectedRevision})
  }
  remove(id:string,expectedRevision:number,confirmed:boolean):{status:'deleted'}|{status:'conflict';current:WrittenNote} {
    if(confirmed!==true)throw Error('Confirm before deleting this written note.')
    validateId(id);integer(expectedRevision,1)
    const row=queryOne('SELECT id FROM written_notes WHERE id=?',[id]);if(!row)return{status:'deleted'}
    const current=this.get(id);if(current.revision!==expectedRevision)return{status:'conflict',current}
    runInTransaction(()=>run('DELETE FROM written_notes WHERE id=? AND revision=?',[id,expectedRevision]));this.dependencies.changed({id,deleted:true});return{status:'deleted'}
  }
  history(id:string):NoteRevision[] { this.get(id);return queryAll<{revision:number;snapshot_json:string;created_at:string}>('SELECT revision,snapshot_json,created_at FROM written_note_versions WHERE note_id=? ORDER BY revision DESC',[id]).map(row=>({revision:row.revision,title:(JSON.parse(row.snapshot_json) as WrittenNote).title,createdAt:row.created_at})) }
  restoreRevision(id:string,revision:number,expectedRevision:number,mutationId:string):NoteMutationResult { const saved=this.get(id,revision);return this.save(id,{title:saved.title,document:saved.document,tags:saved.tags,expectedRevision,mutationId}) }
  export(id:string,format:'markdown'|'text'):{text:string;filename:string} {
    if(format!=='markdown'&&format!=='text')throw Error('Choose Markdown or plain text.')
    const note=this.get(id);return{text:exportNoteDocument(note.title,note.projectName,note.document,format==='markdown'),filename:(note.title.replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').slice(0,100)||'note')+(format==='markdown'?'.md':'.txt')}
  }
  readPage(id:string,options:{revision?:number;cursor?:string|null;limit?:number;includeDocument?:boolean}={}):NoteReadPage {
    if(options.cursor!=null&&typeof options.cursor!=='string')throw Error('Invalid note block cursor.')
    let revision=options.revision
    if(options.cursor){try{const decoded=JSON.parse(Buffer.from(options.cursor,'base64url').toString('utf8'));const pinned=integer(decoded.revision,1);if(revision!==undefined&&revision!==pinned)throw Error();revision=pinned}catch{throw Error('Invalid note block cursor.')}}
    const note=this.get(id,revision),limit=integer(options.limit??20,1,50),identity=['blocks',id,note.revision],offset=pageOffset(options.cursor?this.readBlockCursor(options.cursor):null,identity),blocks=projectNoteBlocks(note.document)
    const next=offset+limit<blocks.length?Buffer.from(JSON.stringify({revision:note.revision,page:pageCursor(offset+limit,identity)})).toString('base64url'):null
    const {document:_document,plainText:_text,documentSchema:_schema,...view}=note
    return{note:view,revision:note.revision,blocks:blocks.slice(offset,offset+limit),nextCursor:next,...(options.includeDocument===true?{document:note.document}:{})}
  }
  search(options:NoteSearchOptions):NoteSearchPage {
    const scope=validateLibraryScope(options.scope),limit=integer(options.limit??20,1,50),identity=['note-search',scope,options.query],offset=pageOffset(options.cursor,identity)
    if(typeof options.query!=='string'||!options.query.trim()||options.query.length>500)throw Error('Use a search of 1–500 characters.')
    if(options.mode!==undefined&&options.mode!=='keywords'&&options.mode!=='meaning')throw Error('Choose keywords or meaning search.')
    const terms=(options.query.toLocaleLowerCase().match(/[\p{L}\p{N}_-]+/gu)??[]).slice(0,30)
    const page=this.list({scope,query:options.query,limit,cursor:offset?pageCursor(offset,['notes',scope,options.query]):null})
    const hits=page.notes.map(row=>{const note=this.get(row.id),ranked=projectNoteBlocks(note.document).map(block=>({block,score:terms.reduce((sum,term)=>sum+Number(block.text.toLocaleLowerCase().includes(term)),0)})).sort((a,b)=>b.score-a.score||a.block.id.localeCompare(b.block.id)),block=ranked[0].block;return{noteId:note.id,title:note.title,projectId:note.projectId,projectName:note.projectName,revision:note.revision,blockId:block.id,heading:block.heading,excerpt:block.text.slice(0,2000)}})
    return{hits,nextCursor:page.nextCursor?pageCursor(offset+limit,identity):null,mode:'keywords',fallbackReason:options.mode==='meaning'?'Meaning search is unavailable. Keyword results are shown.':null}
  }
  private readBlockCursor(cursor:string):string { try{const value=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));if(typeof value.page!=='string')throw Error();return value.page}catch{throw Error('Invalid note block cursor.')} }
  private change(id:string,input:NoteSave,projectId?:string|null,identity?:unknown):NoteMutationResult {
    validateId(id);const mutation=requestId(input.mutationId),revision=integer(input.expectedRevision,1),name=title(input.title),content=validateNoteDocument(input.document),labels=tags(input.tags),payload=createHash('sha256').update(JSON.stringify(identity??{revision,name,content,labels,projectId})).digest('hex')
    let committed=false
    const result=runInTransaction<NoteMutationResult>(()=>{
      const existing=queryOne<{payload_hash:string;revision:number}>('SELECT payload_hash,revision FROM written_note_mutations WHERE note_id=? AND mutation_id=?',[id,mutation])
      if(existing){if(existing.payload_hash!==payload)throw Error('This mutation ID was used for a different note change.');return{status:'saved',note:this.get(id,existing.revision)}}
      const current=this.get(id);if(current.revision!==revision)return{status:'conflict',current}
      const now=(this.dependencies.now?.()??new Date()).toISOString()
      run('UPDATE written_notes SET title=?,document_json=?,plain_text=?,project_id=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?',[name,JSON.stringify(content),notePlainText(content),projectId===undefined?current.projectId:projectId,now,id,revision]);this.saveTags(id,labels);this.snapshot(id)
      run('INSERT INTO written_note_mutations(note_id,mutation_id,payload_hash,revision) VALUES (?,?,?,?)',[id,mutation,payload,revision+1]);run('DELETE FROM written_note_mutations WHERE note_id=? AND revision<=?',[id,revision+1-NOTE_LIMITS.history]);committed=true
      return{status:'saved',note:this.get(id)}
    })
    if(committed)this.dependencies.changed({id});return result
  }
  private saveTags(id:string,labels:string[]):void { run('DELETE FROM written_note_tags WHERE note_id=?',[id]);for(const tag of labels)run('INSERT INTO written_note_tags(note_id,tag) VALUES (?,?)',[id,tag]) }
  private snapshot(id:string):void { const note=this.get(id);run('INSERT INTO written_note_versions(note_id,revision,snapshot_json,created_at) VALUES (?,?,?,?)',[id,note.revision,JSON.stringify(note),note.updatedAt]);run('DELETE FROM written_note_versions WHERE note_id=? AND revision<=?',[id,note.revision-NOTE_LIMITS.history]) }
}
