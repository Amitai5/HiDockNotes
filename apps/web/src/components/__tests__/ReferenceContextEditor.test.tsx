import { setAppClient } from '../../services/app-client'
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { GlobalReferenceContext, ProjectReferenceContext } from '../ReferenceContextEditor'
import type { AppClient } from '../../shared/contracts'
import { EMPTY_REFERENCE_CONTEXT, type ReferenceContext, type ReferenceContextDocument } from '../../shared/reference-context'

const get = vi.fn(), save = vi.fn()
const empty = (): ReferenceContextDocument => ({ content: { ...EMPTY_REFERENCE_CONTEXT }, version: 0, updatedAt: null })
beforeEach(() => {
  get.mockReset().mockResolvedValue(empty())
  save.mockReset().mockImplementation(async (_project: string | null, content: ReferenceContext, version: number) => ({ content, version: version + 1, updatedAt: '2026-10-20T12:00:00Z' }))
  setAppClient({ referenceContext: { get, save } } as unknown as AppClient)
})
afterEach(cleanup)

describe('reference context editors', () => {
  it('saves all global fields explicitly without starting processing', async () => {
    render(<GlobalReferenceContext />)
    await waitFor(() => expect(screen.getByLabelText('Global background')).toBeEnabled())
    expect(screen.getByRole('button', { name: 'Save global context' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Global background'), { target: { value: 'Shared business background' } })
    fireEvent.change(screen.getByLabelText('Global people & organizations'), { target: { value: 'Dana Lee — operations' } })
    fireEvent.change(screen.getByLabelText('Global terminology & spellings'), { target: { value: 'CRM — customer relationship management' } })
    expect(save).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Save global context' }))
    await screen.findByText('Context saved')
    expect(save).toHaveBeenCalledWith(null, { background: 'Shared business background', people: 'Dana Lee — operations', terminology: 'CRM — customer relationship management' }, 0)
    expect(screen.getByRole('button', { name: 'Save global context' })).toBeDisabled()
  })
  it('loads project context only when opened and links to the global editor', async () => {
    get.mockResolvedValue({ content: { ...EMPTY_REFERENCE_CONTEXT, terminology: 'Existing term' }, version: 4, updatedAt: '2026-10-20T12:00:00Z' })
    render(<MemoryRouter><ProjectReferenceContext projectId="project-a" name="Client project" /></MemoryRouter>)
    expect(get).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Project context' }))
    expect(await screen.findByDisplayValue('Existing term')).toBeVisible()
    expect(get).toHaveBeenCalledWith('project-a')
    expect(screen.getByRole('link', { name: /Edit global context/ })).toHaveAttribute('href', '/settings?tab=general&focus=global-context')
    fireEvent.change(screen.getByLabelText('Project background'), { target: { value: 'This client only' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save project context' }))
    await screen.findByText('Context saved')
    expect(save).toHaveBeenCalledWith('project-a', { ...EMPTY_REFERENCE_CONTEXT, background: 'This client only', terminology: 'Existing term' }, 4)
  })
  it('retains an unsaved project draft across closing and reopening the dialog', async () => {
    render(<MemoryRouter><ProjectReferenceContext projectId="project-a" name="Client project" /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Project context' }))
    await waitFor(() => expect(screen.getByLabelText('Project background')).toBeEnabled())
    fireEvent.change(screen.getByLabelText('Project background'), { target: { value: 'Unfinished draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close project context' }))
    fireEvent.click(screen.getByRole('button', { name: 'Project context' }))
    expect(screen.getByLabelText('Project background')).toHaveValue('Unfinished draft')
    expect(get).toHaveBeenCalledOnce()
    expect(save).not.toHaveBeenCalled()
  })
  it('discards local changes without overwriting the saved document', async () => {
    get.mockResolvedValue({ ...empty(), content: { ...EMPTY_REFERENCE_CONTEXT, people: 'Saved person' }, version: 1 })
    render(<GlobalReferenceContext />)
    await screen.findByDisplayValue('Saved person')
    fireEvent.change(screen.getByLabelText('Global people & organizations'), { target: { value: 'Draft person' } })
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(screen.getByLabelText('Global people & organizations')).toHaveValue('Saved person')
    expect(save).not.toHaveBeenCalled()
  })
  it('keeps a rejected draft visible and allows explicitly reloading a newer saved version', async () => {
    save.mockRejectedValueOnce(new Error('This context changed in another window. Reload the saved context before saving again.'))
    render(<GlobalReferenceContext />)
    await waitFor(() => expect(screen.getByLabelText('Global background')).toBeEnabled())
    fireEvent.change(screen.getByLabelText('Global background'), { target: { value: 'Keep my draft visible' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save global context' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('another window')
    expect(screen.getByLabelText('Global background')).toHaveValue('Keep my draft visible')
    get.mockResolvedValueOnce({ ...empty(), content: { ...EMPTY_REFERENCE_CONTEXT, background: 'Newer saved version' }, version: 2 })
    fireEvent.click(screen.getByRole('button', { name: 'Reload saved context' }))
    expect(await screen.findByDisplayValue('Newer saved version')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Save global context' })).toBeDisabled()
  })
  it('disables editing after a load failure and supports retry', async () => {
    get.mockRejectedValueOnce(new Error('The project could not be loaded.'))
    render(<GlobalReferenceContext />)
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded')
    expect(screen.getByLabelText('Global background')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Reload saved context' }))
    await waitFor(() => expect(screen.getByLabelText('Global background')).toBeEnabled())
  })
})
