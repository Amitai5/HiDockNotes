import type { SourceCitation } from '../shared/ai'
import { noteUrl } from './note-url'
import { safeNoteLink } from '../shared/note-document'

const id = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Uses the configured server address, independent of a desktop or LAN alias. */
export function citationNoteLink(citation: SourceCitation, origin: string): string {
  const base = new URL(origin)
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw Error('The server address is not available. Retry before saving this answer.')
  let route: string
  if (citation.kind === 'note') {
    if (!id.test(citation.noteId) || !Number.isSafeInteger(citation.revision) || citation.revision < 1 || !/^[a-zA-Z0-9_-]{1,80}$/.test(citation.blockId) || citation.projectId !== null && !id.test(citation.projectId)) throw Error('This answer contains an invalid written source. Its citation could not be saved.')
    route = noteUrl(citation.noteId, citation.projectId, citation.revision, citation.blockId)
  } else {
    if (!id.test(citation.recordingId) || !Number.isFinite(citation.start) || citation.start < 0) throw Error('This answer contains an invalid recording source. Its citation could not be saved.')
    route = '/library/' + citation.recordingId + '?t=' + citation.start
  }
  return safeNoteLink(new URL('/#' + route, base).href)
}

/** Recognizes only app source routes; ordinary external links keep their usual behavior. */
export function noteSourceRoute(href: string): string | null {
  try {
    const url = new URL(safeNoteLink(href))
    if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/') return null
    const route = url.hash.slice(1), path = route.split('?')[0], match = /^\/(notes|library)\/([^/]+)$/.exec(path)
    return match && id.test(match[2]) ? route : null
  } catch { return null }
}
