import type {SourceCitation,RecordingCitation,WrittenNoteCitation} from '../../../src/shared/ai'
import type {WrittenNotes} from '../services/written-notes'
import {projectNoteBlocks} from '../../../src/shared/note-document'
export function writtenKeywordContext(notes:WrittenNotes,query:string,projectId:string|null):WrittenNoteCitation[] {
  const scope=projectId===null?{kind:'all' as const}:{kind:'project' as const,projectId}
  let hits=notes.search({query:query.slice(0,500)||'notes',scope,limit:6}).hits
  if(!hits.length&&projectId!==null)hits=notes.list({scope,limit:6}).notes.map(row=>{const note=notes.get(row.id),block=projectNoteBlocks(note.document)[0];return{noteId:note.id,title:note.title,projectId:note.projectId,projectName:note.projectName,revision:note.revision,blockId:block.id,heading:block.heading,excerpt:block.text.slice(0,2000)}})
  return hits.map(hit=>({kind:'note',number:0,...hit}))
}
export function combineLibrarySources(lists:{citations:SourceCitation[];weight:number}[]):SourceCitation[] {
  const combined=new Map<string,{citation:SourceCitation;score:number}>()
  for(const {citations,weight} of lists)citations.forEach((citation,index)=>{const key=citation.kind==='note'?'note:'+citation.noteId+':'+citation.revision:'recording:'+citation.recordingId,previous=combined.get(key);combined.set(key,{citation:previous?.citation??citation,score:(previous?.score??0)+weight/(index+60)})})
  let remaining=24000
  return [...combined.values()].sort((a,b)=>b.score-a.score).slice(0,6).map(({citation},index)=>{const excerpt=citation.excerpt.slice(0,Math.max(0,Math.min(remaining,citation.kind==='note'?2000:6000)));remaining-=excerpt.length;return{...citation,number:index+1,excerpt}})
}
export function recordingSources(citations:SourceCitation[]):RecordingCitation[] { return citations.filter((citation):citation is RecordingCitation=>citation.kind!=='note') }
