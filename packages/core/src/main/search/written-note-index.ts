import type {LibraryScope,NoteSearchHit} from '../../../src/shared/notes'
import {projectNoteBlocks,validateNoteDocument} from '../../../src/shared/note-document'
import {queryAll,queryOne,run,runInTransaction} from '../services/database'
import {scopeWhere} from '../services/written-notes'
import {SEARCH_MODEL_ID} from './semantic-model'
import {vectorBytes} from './semantic-index'
export interface NoteSearchDocument {id:string;revision:number;chunks:{blockId:string;heading:string|null;text:string}[]}
export function noteSearchDocument(id:string):NoteSearchDocument|null {
  const row=queryOne<{revision:number;document_json:string;title:string}>('SELECT revision,document_json,title FROM written_notes WHERE id=?',[id]);if(!row)return null
  const blocks=projectNoteBlocks(validateNoteDocument(JSON.parse(row.document_json))),chunks=blocks.flatMap(block=>{const parts=[];for(let offset=0;offset<Math.max(1,block.text.length);offset+=800)parts.push({blockId:block.id,heading:block.heading,text:block.text.slice(offset,offset+800)});return parts})
  return{id,revision:row.revision,chunks:chunks.length?chunks:[{blockId:'title',heading:null,text:row.title}]}
}
export function saveNoteSearchDocument(document:NoteSearchDocument,vectors:number[][],date:string):boolean {
  if(vectors.length!==document.chunks.length)throw Error('The note search index is incomplete.')
  const embeddings=vectors.map(vectorBytes)
  return runInTransaction(()=>{
    if(queryOne<{revision:number}>('SELECT revision FROM written_notes WHERE id=?',[document.id])?.revision!==document.revision)return false
    run('DELETE FROM written_note_semantic_chunks WHERE note_id=?',[document.id])
    for(const [position,chunk]of document.chunks.entries())run('INSERT INTO written_note_semantic_chunks(note_id,revision,position,block_id,heading,text,embedding) VALUES (?,?,?,?,?,?,?)',[document.id,document.revision,position,chunk.blockId,chunk.heading,chunk.text,embeddings[position]])
    run('INSERT OR REPLACE INTO written_note_semantic_documents(note_id,revision,model,indexed_at) VALUES (?,?,?,?)',[document.id,document.revision,SEARCH_MODEL_ID,date]);return true
  })
}
export async function noteSemanticHits(vector:number[],scope:LibraryScope,signal?:AbortSignal):Promise<NoteSearchHit[]> {
  const query=vectorBytes(vector),best=new Map<string,NoteSearchHit>(),parameters:unknown[]=[SEARCH_MODEL_ID],where=scopeWhere(scope,'n',parameters)
  let after=0
  for(;;){
    signal?.throwIfAborted()
    const rows=queryAll<{id:number;note_id:string;revision:number;title:string;projectId:string|null;projectName:string|null;block_id:string;heading:string|null;text:string;embedding:Buffer}>("SELECT c.*,n.title,n.project_id AS projectId,p.name AS projectName FROM written_note_semantic_chunks c JOIN written_notes n ON n.id=c.note_id JOIN written_note_semantic_documents d ON d.note_id=n.id LEFT JOIN projects p ON p.id=n.project_id WHERE d.model=? AND c.revision=n.revision AND d.revision=n.revision"+where+' AND c.id>? ORDER BY c.id LIMIT 512',[...parameters,after])
    for(const row of rows){if(row.embedding.length!==384*4)continue;let score=0;for(let index=0;index<384;index++)score+=query.readFloatLE(index*4)*row.embedding.readFloatLE(index*4);if(score<.25||score<=(best.get(row.note_id)?.score??-1))continue;best.set(row.note_id,{noteId:row.note_id,title:row.title,projectId:row.projectId,projectName:row.projectName,revision:row.revision,blockId:row.block_id,heading:row.heading,excerpt:row.text,score})}
    if(rows.length<512)break;after=rows.at(-1)!.id;await new Promise<void>(resolve=>setImmediate(resolve))
  }
  return [...best.values()].flatMap(hit=>{const current=queryOne<{revision:number;projectId:string|null;projectName:string|null}>('SELECT n.revision,n.project_id AS projectId,p.name AS projectName FROM written_notes n LEFT JOIN projects p ON p.id=n.project_id WHERE n.id=?',[hit.noteId]);return current?.revision===hit.revision&&(scope.kind==='all'||scope.kind==='unfiled'&&current.projectId===null||scope.kind==='project'&&current.projectId===scope.projectId)?[{...hit,projectId:current.projectId,projectName:current.projectName}]:[]}).sort((a,b)=>(b.score??0)-(a.score??0)||a.noteId.localeCompare(b.noteId)).slice(0,1001)
}
