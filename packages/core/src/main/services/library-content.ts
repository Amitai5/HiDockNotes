import type { LibraryContentOptions, LibraryContentPage, LibraryContentRow } from '../../../src/shared/library'
import type { RecordingView } from '../../../src/shared/contracts'
import { queryAll,queryOne } from './database'
import { keywordMatch,pageCursor,pageOffset,scopeWhere,validateLibraryScope } from './written-notes'
interface Row {kind:'note'|'recording';id:string;title:string;projectId:string|null;projectName:string|null;createdAt:string;updatedAt:string;preview:string;revision:number;tags:string;recordingJson:string|null}
export function libraryContent(options:LibraryContentOptions={},meaning?:{notes:string[];recordings:string[];fallbackReason:string|null}):LibraryContentPage {
  if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(key=>!['scope','query','kind','status','from','limit','cursor','mode'].includes(key)))throw Error('Invalid library request.')
  const scope=validateLibraryScope(options.scope),query=options.query??'',kind=options.kind??'all',limit=options.limit??30
  if(typeof query!=='string'||query.length>500||!['all','note','recording'].includes(kind)||!Number.isSafeInteger(limit)||limit<1||limit>50||options.status!==undefined&&(typeof options.status!=='string'||options.status.length>40)||options.from!==undefined&&(typeof options.from!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(options.from))||options.mode!==undefined&&!['keywords','meaning'].includes(options.mode))throw Error('Invalid library filter.')
  const identity=['content',scope,query,kind,options.status??'',options.from??'',options.mode??'keywords'],offset=pageOffset(options.cursor,identity),parameters:unknown[]=[],parts:string[]=[]
  const match=query.trim()?keywordMatch(query):''
  if(query.trim()&&!match)return{items:[],total:0,nextCursor:null}
  if(kind!=='recording'){
    let where=' WHERE 1=1'+scopeWhere(scope,'n',parameters)
    if(match){where+=' AND (n.id IN (SELECT note_id FROM written_note_fts WHERE written_note_fts MATCH ?)';parameters.push(match);if(meaning?.notes.length){where+=' OR n.id IN ('+meaning.notes.map(()=>'?').join(',')+')';parameters.push(...meaning.notes)}where+=')'}
    parts.push("SELECT 'note' AS kind,n.id,n.title,n.project_id AS projectId,p.name AS projectName,n.created_at AS createdAt,n.updated_at AS updatedAt,substr(n.plain_text,1,300) AS preview,n.revision,COALESCE((SELECT json_group_array(tag) FROM written_note_tags WHERE note_id=n.id),'[]') AS tags,NULL AS recordingJson FROM written_notes n LEFT JOIN projects p ON p.id=n.project_id"+where)
  }
  if(kind!=='note'){
    let where=' WHERE 1=1'+scopeWhere(scope,'r',parameters)
    if(match){where+=' AND (r.id IN (SELECT recording_id FROM recording_fts WHERE recording_fts MATCH ?)';parameters.push(match);if(meaning?.recordings.length){where+=' OR r.id IN ('+meaning.recordings.map(()=>'?').join(',')+')';parameters.push(...meaning.recordings)}where+=')'}
    if(options.status){where+=' AND r.status=?';parameters.push(options.status)}
    if(options.from){where+=' AND r.date_recorded>=?';parameters.push(options.from)}
    parts.push("SELECT 'recording' AS kind,r.id,COALESCE(r.title,r.filename) AS title,r.project_id AS projectId,p.name AS projectName,r.date_recorded AS createdAt,r.date_recorded AS updatedAt,substr(COALESCE(s.text,''),1,300) AS preview,NULL AS revision,'[]' AS tags,json_object('id',r.id,'filename',r.filename,'title',r.title,'recordedAt',r.date_recorded,'duration',r.duration_seconds,'size',r.file_size,'status',r.status,'verified',r.verified,'hasAudio',r.file_path IS NOT NULL,'projectId',r.project_id,'summary',substr(s.text,1,300),'processingMode',j.mode,'processingMessage',j.message,'processingProgress',j.progress) AS recordingJson FROM recordings r LEFT JOIN projects p ON p.id=r.project_id LEFT JOIN summaries s ON s.recording_id=r.id LEFT JOIN transcription_jobs j ON j.recording_id=r.id"+where)
  }
  const sql=parts.join(' UNION ALL '),total=queryOne<{count:number}>('SELECT count(*) AS count FROM ('+sql+')',parameters)!.count
  const rows=queryAll<Row>('SELECT * FROM ('+sql+') ORDER BY updatedAt DESC,kind,id LIMIT ? OFFSET ?',[...parameters,limit+1,offset])
  const items=rows.slice(0,limit).map((row):LibraryContentRow=>{
    const base={id:row.id,title:row.title,projectId:row.projectId,projectName:row.projectName,createdAt:row.createdAt,updatedAt:row.updatedAt,preview:row.preview}
    if(row.kind==='note')return{...base,kind:'note',revision:row.revision,tags:JSON.parse(row.tags) as string[]}
    const recording=JSON.parse(row.recordingJson!) as RecordingView;recording.verified=!!recording.verified;recording.hasAudio=!!recording.hasAudio
    return{...base,kind:'recording',recording}
  })
  return{items,total,fallbackReason:meaning?.fallbackReason??null,nextCursor:rows.length>limit?pageCursor(offset+limit,identity):null}
}
