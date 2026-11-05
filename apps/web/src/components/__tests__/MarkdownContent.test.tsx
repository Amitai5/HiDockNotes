// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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

it('opens only saved source numbers inline and keeps code and unknown numbers literal', () => {
  const open = vi.fn(), citation = { number: 1, recordingId: '67b1d399-2d73-48ab-bfee-8a6c91bd0c80', start: 12, title: 'Planning', excerpt: 'Approved the pilot.' }
  render(<MarkdownContent citations={[citation]} onCitation={open}>{'The pilot was approved [1]. Unverified [99]. Code: \u0060[1]\u0060'}</MarkdownContent>)
  const source = screen.getByRole('link', { name: 'Review source 1: Planning' })
  expect(source).toHaveAttribute('href', window.location.origin + '/#/library/67b1d399-2d73-48ab-bfee-8a6c91bd0c80?t=12')
  fireEvent.click(source)
  expect(open).toHaveBeenCalledExactlyOnceWith(citation, source)
  expect(screen.getAllByRole('link')).toHaveLength(1)
  expect(screen.getByText('[1]', { selector: 'code' })).toBeVisible()
  expect(screen.getByText(/Unverified/)).toHaveTextContent('[99]')
})

it('keeps an answer readable when old citation metadata cannot form a valid app link', () => {
  const open = vi.fn()
  render(<MarkdownContent citations={[{ number: 1, recordingId: 'malformed-id', start: -1, title: 'Old source', excerpt: 'Saved evidence' }]} onCitation={open}>{'Saved words [1].'}</MarkdownContent>)
  expect(screen.getByText('Saved words [1].')).toBeVisible()
  expect(screen.queryByRole('link')).toBeNull(); expect(open).not.toHaveBeenCalled()
})
