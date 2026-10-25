import type { NoteDocument, NoteNode, NoteMark, NoteBlock } from './notes'
export const NOTE_LIMITS = { title: 300, bytes: 512 * 1024, depth: 12, nodes: 5000, history: 50 } as const
const blocks = new Set(['paragraph','heading','listItem','taskItem','blockquote'])
const types = new Set(['doc','paragraph','heading','text','hardBreak','bulletList','orderedList','listItem','taskList','taskItem','blockquote'])
const inline = new Set(['text','hardBreak'])
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid note document.'); return value as Record<string,unknown> }
function keys(value: Record<string, unknown>, allowed: string[]): void { if (Object.keys(value).some(key => !allowed.includes(key))) throw Error('Unsupported note content or attributes.') }
export function safeNoteLink(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) throw Error('Use a complete http, https or mailto link.')
  let url: URL; try { url = new URL(value) } catch { throw Error('Use a complete http, https or mailto link.') }
  if (!['https:','http:','mailto:'].includes(url.protocol) || url.username || url.password) throw Error('Use a complete http, https or mailto link.')
  return value
}
export function emptyNoteDocument(id = crypto.randomUUID()): NoteDocument { return { type: 'doc', content: [{ type:'paragraph', attrs:{id}, content:[] }] } }
export function validateNoteDocument(value: unknown): NoteDocument {
  let bytes: number; try { bytes = new TextEncoder().encode(JSON.stringify(value)).length } catch { throw Error('Invalid note document.') }
  if (bytes > NOTE_LIMITS.bytes) throw Error('This note exceeds the 512 KiB document limit. Split it into smaller notes.')
  let count = 0; const ids = new Set<string>()
  function node(input: unknown, depth: number): NoteNode {
    if (++count > NOTE_LIMITS.nodes || depth > NOTE_LIMITS.depth) throw Error('This note exceeds the document nesting or node limit.')
    const raw = object(input); keys(raw,['type','attrs','text','marks','content'])
    if (typeof raw.type !== 'string' || !types.has(raw.type) || raw.type === 'doc' && depth !== 0) throw Error('Unsupported note document node.')
    const type = raw.type as NoteNode['type'], result: NoteNode = {type}, attrs = raw.attrs === undefined ? {} : object(raw.attrs)
    const allowed = blocks.has(type) ? ['id',...(type === 'heading' ? ['level'] : type === 'taskItem' ? ['checked'] : [])] : type === 'orderedList' ? ['start'] : []
    keys(attrs, allowed)
    if (blocks.has(type)) {
      if (typeof attrs.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(attrs.id) || ids.has(attrs.id)) throw Error('Each note block needs a unique, valid ID.')
      ids.add(attrs.id); result.attrs={id:attrs.id}
    }
    if (type === 'heading') { if (attrs.level !== 1 && attrs.level !== 2) throw Error('Choose heading level 1 or 2.'); result.attrs!.level=attrs.level }
    if (type === 'taskItem') { if (typeof attrs.checked !== 'boolean') throw Error('Invalid checklist state.'); result.attrs!.checked=attrs.checked }
    if (type === 'orderedList') { const start=attrs.start ?? 1; if (typeof start !== 'number' || !Number.isSafeInteger(start) || start < 1 || start > 1000000) throw Error('Invalid numbered-list start.'); result.attrs={start} }
    if (type === 'text') {
      if (typeof raw.text !== 'string' || !raw.text.length || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(raw.text) || raw.content !== undefined) throw Error('Invalid note text.')
      result.text=raw.text
      if (raw.marks !== undefined) {
        if (!Array.isArray(raw.marks) || raw.marks.length > 4) throw Error('Invalid text formatting.')
        const seen = new Set<string>()
        result.marks=raw.marks.map(inputMark => {
          const mark=object(inputMark); keys(mark,['type','attrs'])
          if (typeof mark.type !== 'string' || !['bold','italic','underline','link'].includes(mark.type) || seen.has(mark.type)) throw Error('Unsupported text formatting.')
          seen.add(mark.type); const next: NoteMark={type:mark.type as NoteMark['type']}
          if (mark.type === 'link') { const link=object(mark.attrs); keys(link,['href','target','rel','class']); if (link.target != null && link.target !== '_blank' && link.target !== '_self' || link.rel != null && link.rel !== 'noopener noreferrer nofollow' && link.rel !== 'noopener noreferrer' || link.class != null) throw Error('Unsupported link attributes.'); next.attrs={href:safeNoteLink(link.href)} }
          else if (mark.attrs !== undefined && Object.keys(object(mark.attrs)).length) throw Error('Unsupported text formatting attributes.')
          return next
        })
      }
      return result
    }
    if (raw.text !== undefined || raw.marks !== undefined) throw Error('Only text nodes may contain text formatting.')
    if (type === 'hardBreak') { if (raw.content !== undefined) throw Error('Invalid line break.'); return result }
    if (raw.content !== undefined && !Array.isArray(raw.content)) throw Error('Invalid block content.')
    const children=(raw.content as unknown[] | undefined ?? []).map(child => node(child,depth+1))
    const childTypes = type === 'paragraph' || type === 'heading' ? inline : type === 'bulletList' || type === 'orderedList' ? new Set(['listItem']) : type === 'taskList' ? new Set(['taskItem']) : type === 'doc' || type === 'blockquote' || type === 'listItem' || type === 'taskItem' ? new Set(['paragraph','heading','bulletList','orderedList','taskList','blockquote']) : new Set<string>()
    if (children.some(child=>!childTypes.has(child.type)) || ['doc','listItem','taskItem','blockquote','bulletList','orderedList','taskList'].includes(type) && !children.length || (type === 'listItem' || type === 'taskItem') && children[0]?.type !== 'paragraph') throw Error('Invalid note block structure.')
    result.content=children; return result
  }
  const result=node(value,0)
  if (result.type !== 'doc') throw Error('A note must have a document root.')
  return result as NoteDocument
}
export function duplicateNoteDocument(value: NoteDocument): NoteDocument {
  const result=validateNoteDocument(value)
  const renew=(node:NoteNode):void=>{if(blocks.has(node.type))node.attrs={...node.attrs,id:crypto.randomUUID()};node.content?.forEach(renew)}
  renew(result);return result
}
function text(node: NoteNode, markdown: boolean): string {
  if (node.type==='hardBreak') return markdown ? '  \n' : '\n'
  let value=node.text ?? ''
  if (markdown) value=value.replace(/[\\`*_{}\[\]#]/g,'\\$&').replaceAll('<','&lt;').replaceAll('>','&gt;')
  for(const mark of node.marks ?? []) {
    if(mark.type==='link') value=markdown ? '['+value+']('+safeNoteLink(mark.attrs?.href).replaceAll('(','\\(').replaceAll(')','\\)')+')' : value+' ('+safeNoteLink(mark.attrs?.href)+')'
    else if(markdown) value=mark.type==='bold'?'**'+value+'**':mark.type==='italic'?'*'+value+'*':'<u>'+value+'</u>'
  }
  return value
}
export function projectNoteBlocks(document: NoteDocument, markdown = false): NoteBlock[] {
  const result: NoteBlock[]=[]; let heading: string | null=null
  function walk(node:NoteNode,depth:number,prefix=''):void {
    if(node.type==='paragraph'||node.type==='heading') {
      const value=(node.content??[]).map(child=>text(child,markdown)).join('')
      if(node.type==='heading')heading=(node.content??[]).map(child=>text(child,false)).join('')
      const content=prefix+(markdown&&node.type==='heading'?'#'.repeat(node.attrs!.level!)+' ':'')+value
      for(let start=0;start<Math.max(1,content.length);start+=4000)result.push({id:node.attrs!.id!,part:start/4000,type:node.type,heading,text:content.slice(start,start+4000),depth})
      return
    }
    if(node.type==='bulletList'||node.type==='orderedList'||node.type==='taskList') {
      node.content?.forEach((child,index)=>{
        const marker=node.type==='orderedList'?String((node.attrs?.start??1)+index)+'. ':node.type==='taskList'?(child.attrs?.checked?'[x] ':'[ ] '):'- '
        const before=result.length
        child.content?.forEach((item,childIndex)=>walk(item,depth+1,childIndex===0?marker:''))
        if(node.type==='taskList'&&result[before])result[before].checked=child.attrs?.checked
      });return
    }
    if(node.type==='blockquote') { const start=result.length;node.content?.forEach(child=>walk(child,depth));for(let index=start;index<result.length;index++){result[index].text='> '+result[index].text;result[index].type='blockquote'};return }
    node.content?.forEach(child=>walk(child,depth))
  }
  walk(document,0);return result
}
export function notePlainText(document: NoteDocument): string { return projectNoteBlocks(document).map(block=>'  '.repeat(Math.max(0,block.depth-1))+block.text).join('\n') }
export function exportNoteDocument(title:string,project:string|null,document:NoteDocument,markdown:boolean):string {
  const escaped=(value:string)=>value.replace(/[\\`*_{}\[\]#]/g,'\\$&').replaceAll('<','&lt;').replaceAll('>','&gt;')
  return (markdown?'# '+escaped(title):title)+'\n\n'+(project?'Project: '+(markdown?escaped(project):project)+'\n\n':'')+projectNoteBlocks(validateNoteDocument(document),markdown).map(block=>'  '.repeat(Math.max(0,block.depth-1))+block.text).join('\n\n')+'\n'
}
