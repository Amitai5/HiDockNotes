import { memo } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const plugins = [remarkGfm]
/** Playback updates do not need to parse an unchanged summary again. */
export const MarkdownContent = memo(function MarkdownContent({ children }: { children: string }): JSX.Element {
  return <div className="markdown-content"><Markdown remarkPlugins={plugins} skipHtml components={{
    // Notes can contain untrusted provider text. Render image descriptions
    // locally instead of loading tracking images or filesystem references.
    img: ({ alt }) => <span className="muted">{alt ?? ''}</span>,
    a: ({ href, children: label }) => <a href={href} target="_blank" rel="noreferrer">{label}</a>,
    table: ({ children: rows }) => <div className="markdown-table"><table>{rows}</table></div>
  }}>{children}</Markdown></div>
})
