import{safeNoteLink}from'../shared/note-document'
/** Keeps only the document schema's clipboard elements; pasted IDs and active content are discarded. */
export function sanitizeNotePaste(html:string):string{
  const document=new DOMParser().parseFromString(html,'text/html'),allowed=new Set(['P','H1','H2','STRONG','B','EM','I','U','A','UL','OL','LI','BLOCKQUOTE','BR','DIV','SPAN'])
  for(const node of [...document.body.querySelectorAll('script,style,iframe,object,embed,img,video,audio,svg,math,link,meta,input,button,form')])node.remove()
  for(const node of [...document.body.querySelectorAll('*')]){
    if(!allowed.has(node.tagName)){node.replaceWith(...node.childNodes);continue}
    const href=node.tagName==='A'?node.getAttribute('href'):null,start=node.tagName==='OL'?node.getAttribute('start'):null,type=node.getAttribute('data-type'),checked=node.getAttribute('data-checked')
    for(const attribute of [...node.attributes])node.removeAttribute(attribute.name)
    if(href){try{node.setAttribute('href',safeNoteLink(href))}catch{node.replaceWith(...node.childNodes);continue}}
    if(start&&/^\d{1,6}$/.test(start)&&Number(start)>0)node.setAttribute('start',start)
    if(node.tagName==='UL'&&type==='taskList'||node.tagName==='LI'&&type==='taskItem')node.setAttribute('data-type',type!)
    if(node.tagName==='LI'&&type==='taskItem')node.setAttribute('data-checked',String(checked==='true'))
  }
  return document.body.innerHTML
}
