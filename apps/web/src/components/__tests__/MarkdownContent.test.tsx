// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MarkdownContent } from '../MarkdownContent'

afterEach(cleanup)
describe('formatted recording summaries', () => {
  it('renders headings, emphasis, lists, tables, and code as elements instead of Markdown markers', () => {
    render(<MarkdownContent>{'## Decisions\n\nThe **budget** is approved.\n\n- Send the plan\n- Review costs\n\n| Owner | Task |\n| --- | --- |\n| Dana | Plan |\n\n`project-code`'}</MarkdownContent>)
    expect(screen.getByRole('heading', { level: 2, name: 'Decisions' })).toBeInTheDocument()
    expect(screen.getByText('budget').tagName).toBe('STRONG')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByText('project-code').tagName).toBe('CODE')
    expect(screen.queryByText('## Decisions')).not.toBeInTheDocument()
  })
  it('does not execute raw HTML, unsafe links, or load remote images', () => {
    const { container } = render(<MarkdownContent>{'<script>alert(1)</script>\n\n<img src="https://example.invalid/tracker" onerror="alert(1)">\n\n[Unsafe](javascript:alert%281%29)\n\n![Diagram](https://example.invalid/tracker.png)'}</MarkdownContent>)
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('Unsafe').getAttribute('href')).not.toMatch(/^javascript:/)
    expect(screen.getByText('Diagram')).toBeInTheDocument()
  })
  it('hides only the action-item section in notes while preserving later sections and exports', () => {
    const summary = 'Purpose.\n\n## Action items\n\n| Task | Owner |\n| --- | --- |\n| Send the plan | Dana |\n\n## Next steps\n\nMeet again.'
    const view = render(<MarkdownContent hideActionItems>{summary}</MarkdownContent>)
    expect(screen.queryByRole('heading', { name: 'Action items' })).toBeNull()
    expect(screen.queryByText('Send the plan')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Next steps' })).toBeVisible()
    view.rerender(<MarkdownContent>{summary}</MarkdownContent>)
    expect(screen.getByText('Send the plan')).toBeVisible()
  })
})
