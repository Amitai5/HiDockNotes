import type { NoteCreate, NoteListOptions, NoteSave } from '../../../src/shared/notes'
import { WrittenNotes } from '../services/written-notes'
import { handle } from './trusted-ipc'
function input<T>(value:unknown,fields:string[]):T { if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!fields.includes(key)))throw Error('Invalid written-note request.');return value as T }
export function registerNoteHandlers(notes:WrittenNotes):void {
  handle('notes:list',(value={})=>notes.list(input<NoteListOptions>(value,['scope','query','limit','cursor'])))
  handle('notes:get',(id,revision)=>notes.get(id,revision))
  handle('notes:create',value=>notes.create(input<NoteCreate>(value,['requestId','projectId','sourceId','title','document','tags'])))
  handle('notes:save',(id,value)=>notes.save(id,input<NoteSave>(value,['title','document','tags','expectedRevision','mutationId'])))
  handle('notes:move',(id,project,revision,mutation)=>notes.move(id,project,revision,mutation))
  handle('notes:delete',(id,revision,confirmed)=>notes.remove(id,revision,confirmed))
  handle('notes:history',id=>notes.history(id))
  handle('notes:restore-revision',(id,revision,expectedRevision,mutation)=>notes.restoreRevision(id,revision,expectedRevision,mutation))
  handle('notes:export',(id,format)=>notes.export(id,format))
}
