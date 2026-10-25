import type {NoteCreate,NoteMutationResult,NoteSave,NotesClient,WrittenNote} from '../shared/notes'
import {duplicateNoteDocument} from '../shared/note-document'
import type {NoteDraft} from './note-drafts'
type Fields=Pick<WrittenNote,'title'|'document'|'tags'>
export interface NoteSessionState {note:WrittenNote;draft:Fields;status:'saved'|'unsaved'|'saving'|'error'|'conflict'|'deleted';error:string;storageError:string;conflict:WrittenNote|null;recovery:NoteDraft|null}
interface Store {read(id:string):Promise<NoteDraft|null>;write(draft:NoteDraft):Promise<void>;remove(id:string):Promise<void>}
const fields=(note:Fields):Fields=>({title:note.title,document:note.document,tags:[...note.tags]})
const fingerprint=(value:Fields)=>JSON.stringify(value)
function message(error:unknown):string{return error instanceof Error?error.message:'The note could not be saved. Your draft is retained.'}
/** Coalesces edits behind one idempotent request and never overwrites a conflicting revision. */
export class NoteSession {
  private state:NoteSessionState
  private listeners=new Set<()=>void>()
  private savedFingerprint:string
  private baseRevision:number
  private attempt:NoteSave|null=null
  private active:Promise<boolean>|null=null
  private timer:ReturnType<typeof setTimeout>|null=null
  private closed=false
  private remotePending=false
  private copyRequest:{input:NoteCreate;fingerprint:string}|null=null
  private storage:Promise<void>=Promise.resolve()
  constructor(note:WrittenNote,private readonly api:NotesClient,private readonly store:Store,private readonly mutationId:()=>string=()=>crypto.randomUUID()){
    this.state={note,draft:fields(note),status:'saved',error:'',storageError:'',conflict:null,recovery:null};this.savedFingerprint=fingerprint(this.state.draft);this.baseRevision=note.revision
  }
  getSnapshot=():NoteSessionState=>this.state
  open():void{this.closed=false}
  subscribe=(listener:()=>void):(()=>void)=>{this.listeners.add(listener);return()=>this.listeners.delete(listener)}
  get dirty():boolean{return this.state.status!=='deleted'&&(fingerprint(this.state.draft)!==this.savedFingerprint||!!this.attempt||!!this.active)}
  private publish(patch:Partial<NoteSessionState>):void{this.state={...this.state,...patch};if(!this.closed)for(const listener of this.listeners)listener()}
  async loadRecovery():Promise<void>{try{const draft=await this.store.read(this.state.note.id);if(!this.closed&&draft&&(draft.attempt||fingerprint(fields(draft))!==fingerprint(this.state.draft)))this.publish({recovery:draft})}catch(error){this.publish({storageError:message(error)})}}
  edit(patch:Partial<Fields>):void{
    if(this.closed||this.state.status==='deleted')return
    this.publish({draft:{...this.state.draft,...patch},status:this.state.status==='conflict'?'conflict':this.state.status==='error'?'error':this.active?'saving':'unsaved'})
    void this.persist()
    if(this.timer)clearTimeout(this.timer)
    if(!['conflict','error'].includes(this.state.status))this.timer=setTimeout(()=>{this.timer=null;void this.flush()},700)
  }
  async recover():Promise<void>{const recovery=this.state.recovery;if(!recovery)return;this.baseRevision=recovery.baseRevision;this.attempt=recovery.attempt??null;this.publish({draft:fields(recovery),recovery:null,status:'unsaved'});if(this.baseRevision!==this.state.note.revision&&!this.attempt)this.publish({status:'conflict',conflict:this.state.note,error:'This note changed while these edits were offline. Keep the draft or save a separate copy.'});else await this.flush()}
  async discardRecovery():Promise<void>{await this.removeDraft();this.publish({recovery:null})}
  flush():Promise<boolean>{
    if(this.active)return this.active
    if(this.state.status==='deleted'||this.state.status==='conflict')return Promise.resolve(false)
    if(this.timer)clearTimeout(this.timer);this.timer=null
    const task=this.save();this.active=task
    void task.finally(()=>{if(this.active===task)this.active=null;if(this.remotePending&&!this.closed){this.remotePending=false;void this.refresh()}}).catch(()=>undefined)
    return task
  }
  private async save():Promise<boolean>{
    try{
      while(this.attempt||fingerprint(this.state.draft)!==this.savedFingerprint){
        const input=this.attempt??{...fields(this.state.draft),expectedRevision:this.baseRevision,mutationId:this.mutationId()};this.attempt=input;this.publish({status:'saving',error:''});await this.persist()
        const result=await this.api.save(this.state.note.id,input)
        if(this.state.status==='deleted')return false
        if(result.status==='conflict'){this.publish({status:'conflict',conflict:result.current,error:'This note changed in another window. Your draft has been kept.'});await this.persist();return false}
        if(result.note.revision<this.state.note.revision){this.publish({status:'conflict',conflict:this.state.note,error:'A newer saved revision exists. Your draft has been kept.'});await this.persist();return false}
        this.attempt=null;this.baseRevision=result.note.revision;this.savedFingerprint=fingerprint(fields(input));this.publish({note:result.note})
        if(fingerprint(this.state.draft)===this.savedFingerprint){await this.removeDraft();if(fingerprint(this.state.draft)===this.savedFingerprint)this.publish({status:'saved',error:'',conflict:null})}
        else await this.persist()
        if(this.closed)break
      }
      return !this.dirty||this.state.status==='saved'
    }catch(error){if(message(error).includes('Written note was not found'))await this.deleted();else if(this.state.status!=='deleted'){this.publish({status:'error',error:message(error)});await this.persist()}return false}
  }
  async refresh():Promise<void>{
    if(this.active){this.remotePending=true;return}
    try{const current=await this.api.get(this.state.note.id);if(this.closed)return;if(current.revision===this.state.note.revision){if(current.projectId!==this.state.note.projectId||current.projectName!==this.state.note.projectName)this.publish({note:{...this.state.note,projectId:current.projectId,projectName:current.projectName}});return}if(this.dirty){this.publish({status:'conflict',conflict:current,error:'This note changed in another window. Your draft has been kept.'})}else this.accept(current)}catch(error){if(message(error).includes('Written note was not found'))await this.deleted();else this.publish({error:message(error)})}
  }
  async reload():Promise<void>{const note=await this.api.get(this.state.note.id);this.attempt=null;this.accept(note);await this.removeDraft()}
  accept(note:WrittenNote):void{this.baseRevision=note.revision;this.savedFingerprint=fingerprint(fields(note));this.attempt=null;this.publish({note,draft:fields(note),status:'saved',error:'',conflict:null,recovery:null})}
  async applyMutation(action:(note:WrittenNote)=>Promise<NoteMutationResult>):Promise<boolean>{if(!await this.flush())return false;this.publish({status:'saving'});try{const result=await action(this.state.note);if(result.status==='conflict'){this.publish({status:'conflict',conflict:result.current,error:'This note changed in another window. Your draft has been kept.'});return false}this.accept(result.note);return true}catch(error){this.publish({status:'error',error:message(error)});return false}}
  async copyDraft():Promise<WrittenNote>{const request=this.copyRequest??{input:{requestId:this.mutationId(),projectId:this.state.note.projectId,title:this.state.draft.title.slice(0,295)+' copy',document:duplicateNoteDocument(this.state.draft.document),tags:[...this.state.draft.tags]},fingerprint:fingerprint(this.state.draft)};this.copyRequest=request;const note=await this.api.create(request.input);this.copyRequest=null;if(fingerprint(this.state.draft)===request.fingerprint){await this.removeDraft();this.accept(this.state.note)}return note}
  async deleted():Promise<void>{if(this.timer)clearTimeout(this.timer);this.timer=null;this.attempt=null;this.publish({status:'deleted',error:'This written note was deleted. Its private recovery draft was cleared.'});await this.removeDraft()}
  private removeDraft():Promise<void>{this.storage=this.storage.then(()=>this.store.remove(this.state.note.id)).catch(error=>this.publish({storageError:message(error)}));return this.storage}
  private persist():Promise<void>{const draft:NoteDraft={id:this.state.note.id,baseRevision:this.baseRevision,...fields(this.state.draft),...(this.attempt?{attempt:this.attempt}:{}),updatedAt:new Date().toISOString()};this.storage=this.storage.then(async()=>{if(this.state.status==='deleted')return;try{await this.store.write(draft);this.publish({storageError:''})}catch(error){this.publish({storageError:message(error)})}});return this.storage}
  close():void{this.closed=true;if(this.timer)clearTimeout(this.timer);this.timer=null;if(this.dirty)void this.persist()}
}
