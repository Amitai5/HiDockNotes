import { memo } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const plugins = [remarkGfm]
interface MarkdownNode { type: string; depth?: number; value?: string; children?: MarkdownNode[] }
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
/** Playback updates do not need to parse an unchanged summary again. */
export const MarkdownContent = memo(function MarkdownContent({ children, hideActionItems = false }: { children: string; hideActionItems?: boolean }): JSX.Element {
  return <div className="markdown-content"><Markdown remarkPlugins={hideActionItems ? summaryPlugins : plugins} skipHtml components={{
    // Notes can contain untrusted provider text. Render image descriptions
    // locally instead of loading tracking images or filesystem references.
    img: ({ alt }) => <span className="muted">{alt ?? ''}</span>,
    a: ({ href, children: label }) => <a href={href} target="_blank" rel="noreferrer">{label}</a>,
    table: ({ children: rows }) => <div className="markdown-table"><table>{rows}</table></div>
  }}>{children}</Markdown></div>
})
