import type {NoteDocument,NoteSave} from '../shared/notes'
export interface NoteDraft {id:string;baseRevision:number;title:string;document:NoteDocument;tags:string[];attempt?:NoteSave;updatedAt:string}
let owner:string|null=null,generation=0,database:Promise<IDBDatabase>|null=null
export function setNoteDraftOwner(username:string|null):void {if(owner!==username){owner=username;generation++}}
function scope():string|null{return owner?location.origin+'|'+encodeURIComponent(owner):null}
function open():Promise<IDBDatabase>{
  if(!globalThis.indexedDB)return Promise.reject(Error('Recovery storage is unavailable in this browser. Keep this window open until the server saves.'))
  return database??=new Promise((resolve,reject)=>{const request=indexedDB.open('hidock-note-recovery',1);request.onupgradeneeded=()=>request.result.createObjectStore('drafts',{keyPath:'key'});request.onerror=()=>{database=null;reject(Error('The browser could not open private note recovery storage.'))};request.onsuccess=()=>resolve(request.result)})
}
async function transaction<T>(mode:IDBTransactionMode,action:(store:IDBObjectStore)=>IDBRequest<T>):Promise<T>{const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('drafts',mode),request=action(tx.objectStore('drafts'));let value:T;request.onsuccess=()=>{value=request.result};tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(Error('The browser could not save the recovery draft.'));tx.onabort=()=>reject(Error('The recovery draft transaction was interrupted.'))})}
export async function readNoteDraft(id:string):Promise<NoteDraft|null>{const key=scope(),session=generation;if(!key)return null;const row=await transaction('readonly',store=>store.get(key+'|'+id));return session===generation&&key===scope()&&row?.draft?.id===id?row.draft:null}
export async function writeNoteDraft(draft:NoteDraft):Promise<void>{const key=scope(),session=generation;if(!key)throw Error('Sign in before storing a private recovery draft.');const db=await open();if(session!==generation||key!==scope())return;await new Promise<void>((resolve,reject)=>{const tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').put({key:key+'|'+draft.id,draft});tx.oncomplete=()=>resolve();tx.onerror=()=>reject(Error('The browser could not save the recovery draft.'));tx.onabort=()=>reject(Error('The recovery draft transaction was interrupted.'))})}
export async function removeNoteDraft(id:string):Promise<void>{const key=scope();if(key)await transaction('readwrite',store=>store.delete(key+'|'+id))}
/** Bind queued editor work to the owner who opened it, including across sign-out/sign-in. */
export function captureNoteDraftStore(){const session=generation,key=scope(),active=()=>session===generation&&key===scope();return{read:(id:string)=>active()?readNoteDraft(id):Promise.resolve(null),write:(draft:NoteDraft)=>active()?writeNoteDraft(draft):Promise.resolve(),remove:(id:string)=>active()?removeNoteDraft(id):Promise.resolve()}}
export async function clearOwnerNoteDrafts():Promise<void>{
  const key=scope();owner=null;generation++;if(!key)return
  const db=await open().catch(()=>null);if(!db)return
  await new Promise<void>((resolve,reject)=>{const tx=db.transaction('drafts','readwrite'),store=tx.objectStore('drafts'),request=store.openCursor();request.onsuccess=()=>{const cursor=request.result;if(cursor){if(typeof cursor.key==='string'&&cursor.key.startsWith(key+'|'))cursor.delete();cursor.continue()}};tx.oncomplete=()=>resolve();tx.onerror=()=>reject(Error('Private recovery drafts could not be cleared.'))})
}
