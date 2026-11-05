import { memo, useMemo } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { SourceCitation } from '../shared/ai'
import { citationNoteLink } from '../services/note-source-links'

const plugins = [remarkGfm]
interface MarkdownNode { type: string; depth?: number; value?: string; url?: string; children?: MarkdownNode[] }
function omitActionItems(): (tree: MarkdownNode) => void {
  return tree => {
    if (!tree.children) return
    const text = (node: MarkdownNode): string => node.value ?? node.children?.map(text).join('') ?? ''
    let depth: number | undefined
    tree.children = tree.children.filter(node => {
      if (node.type === 'heading' && depth !== undefined && node.depth! <= depth) depth = undefined
      if (node.type === 'heading' && /^action\s+items\s*[:—-]?$/i.test(text(node).trim())) depth = node.depth
      return depth === undefined
    })
  }
}
const summaryPlugins = [remarkGfm, omitActionItems]

function sourceHref(source: SourceCitation): string | null {
  try { return citationNoteLink(source, window.location.origin) }
  catch { return null } // Malformed historical metadata must not hide the saved answer.
}

/** Only source numbers supplied with the saved answer become evidence links. */
function citationLinks(citations: SourceCitation[]): () => (tree: MarkdownNode) => void {
  const sources = new Map(citations.map(source => [source.number, source]))
  return () => {
    const visit = (node: MarkdownNode): void => {
      if (['link', 'code', 'inlineCode', 'image'].includes(node.type)) return
      node.children = node.children?.flatMap(child => {
        if (child.type !== 'text' || !child.value) { visit(child); return [child] }
        const result: MarkdownNode[] = [], text = child.value
        let offset = 0
        for (const match of text.matchAll(/\[(\d+)\]/g)) {
          const source = sources.get(Number(match[1]))
          const href = source && sourceHref(source)
          if (!href) continue
          if (match.index > offset) result.push({ type: 'text', value: text.slice(offset, match.index) })
          result.push({ type: 'link', url: href, children: [{ type: 'text', value: match[0] }] })
          offset = match.index + match[0].length
        }
        if (offset < text.length) result.push({ type: 'text', value: text.slice(offset) })
        return result
      })
    }
    return visit
  }
}

/** Playback updates do not need to parse an unchanged summary again. */
export const MarkdownContent = memo(function MarkdownContent({ children, hideActionItems = false, citations, onCitation }: { children: string; hideActionItems?: boolean; citations?: SourceCitation[]; onCitation?(citation: SourceCitation, trigger: HTMLElement): void }): JSX.Element {
  const selectedPlugins = useMemo(() => {
    const base = hideActionItems ? summaryPlugins : plugins
    return citations?.length ? [...base, citationLinks(citations)] : base
  }, [hideActionItems, citations])
  return <div className="markdown-content"><Markdown remarkPlugins={selectedPlugins} skipHtml components={{
    // Provider text must not load tracking images or filesystem references.
    img: ({ alt }) => <span className="muted">{alt ?? ''}</span>,
    a: ({ href, children: label }) => {
      const number = /^\[(\d+)\]$/.exec(String(label))
      const citation = number ? citations?.find(source => source.number === Number(number[1]) && sourceHref(source) === href) : undefined
      return <a href={href} className={citation ? 'inline-citation' : undefined} aria-label={citation ? `Review source ${citation.number}: ${citation.title}` : undefined} target="_blank" rel="noreferrer" onClick={event => { if (citation && onCitation && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onCitation(citation, event.currentTarget) } }}>{label}</a>
    },
    table: ({ children: rows }) => <div className="markdown-table"><table>{rows}</table></div>
  }}>{children}</Markdown></div>
})
