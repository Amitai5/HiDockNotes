// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { RecordingWorkspace } from '../RecordingWorkspace'

afterEach(cleanup)
describe('resizable recording sidebar', () => {
  it('separates notes from playback and supports bounded keyboard resizing', () => {
    render(<RecordingWorkspace notes={<h2>Summary</h2>} media={<h2>Transcript</h2>} />)
    const handle = screen.getByRole('separator', { name: 'Resize audio and transcript sidebar' })
    expect(screen.getByRole('complementary', { name: 'Audio and transcript' })).toContainElement(screen.getByText('Transcript'))
    expect(screen.getByRole('complementary')).not.toContainElement(screen.getByRole('heading', { name: 'Summary' }))
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(handle).toHaveAttribute('aria-valuenow', '452')
    fireEvent.keyDown(handle, { key: 'Home' })
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(handle).toHaveAttribute('aria-valuenow', '300')
    fireEvent.keyDown(handle, { key: 'End' })
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(handle).toHaveAttribute('aria-valuenow', '800')
    fireEvent.doubleClick(handle)
    expect(handle).toHaveAttribute('aria-valuenow', '432')
  })
})

it('hides the evidence pane without remounting its playback or losing the document', () => {
  const view = render(<RecordingWorkspace notes={<input aria-label="Summary draft" defaultValue="Kept draft" />} media={<input aria-label="Playback position" defaultValue="42" />} />)
  const playback = screen.getByLabelText('Playback position')
  view.rerender(<RecordingWorkspace mediaOpen={false} notes={<input aria-label="Summary draft" defaultValue="Kept draft" />} media={<input aria-label="Playback position" defaultValue="42" />} />)
  expect(screen.queryByRole('complementary', { name: 'Audio and transcript' })).toBeNull()
  expect(screen.queryByRole('separator')).toBeNull()
  expect(screen.getByLabelText('Summary draft')).toHaveValue('Kept draft')
  view.rerender(<RecordingWorkspace mediaOpen notes={<input aria-label="Summary draft" defaultValue="Kept draft" />} media={<input aria-label="Playback position" defaultValue="42" />} />)
  expect(screen.getByLabelText('Playback position')).toBe(playback)
  expect(playback).toHaveValue('42')
})

it('switches mobile reading panes without remounting playback or losing its position', () => {
  const view = render(<RecordingWorkspace notes={<input aria-label="Summary draft" defaultValue="Kept draft" />} media={<input aria-label="Playback position" defaultValue="42" />} />)
  const playback = screen.getByLabelText('Playback position')
  fireEvent.click(screen.getByRole('button', { name: 'Audio & transcript' }))
  expect(view.container.firstChild).toHaveAttribute('data-mobile-view', 'media')
  fireEvent.click(screen.getByRole('button', { name: 'Summary', exact: true }))
  expect(view.container.firstChild).toHaveAttribute('data-mobile-view', 'notes')
  expect(screen.getByLabelText('Playback position')).toBe(playback)
  expect(playback).toHaveValue('42')
})

it('reopens a closed media pane and returns to Summary when the pane closes', () => {
  const opened: boolean[] = []
  const view = render(<RecordingWorkspace mediaOpen={false} onMediaOpenChange={value => opened.push(value)} notes={<p>Notes</p>} media={<p>Evidence</p>} />)
  fireEvent.click(screen.getByRole('button', { name: 'Audio & transcript' }))
  expect(opened).toEqual([true])
  view.rerender(<RecordingWorkspace mediaOpen notes={<p>Notes</p>} media={<p>Evidence</p>} />)
  expect(view.container.firstChild).toHaveAttribute('data-mobile-view', 'media')
  view.rerender(<RecordingWorkspace mediaOpen={false} notes={<p>Notes</p>} media={<p>Evidence</p>} />)
  expect(view.container.firstChild).toHaveAttribute('data-mobile-view', 'notes')
})
