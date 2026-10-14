// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SpeakerEditor, speakerColor, speakerColors } from '../SpeakerEditor'
import type { ElectronAPI } from '../../shared/contracts'
afterEach(cleanup)
describe('speaker naming popup', () => {
  function setup() {
    window.electronAPI = { voices: { list: vi.fn(async () => [{ id: 'dana', name: 'Dana Lee', samples: [] }]), nameSpeaker: vi.fn(async () => undefined), assignSegment: vi.fn(async () => undefined) } } as unknown as ElectronAPI
    return { onClose: vi.fn(), onSaved: vi.fn() }
  }
  it('uses a real profile selector, fills the name and saves a remembered speaker', async () => {
    const props = setup()
    render(<SpeakerEditor recordingId="recording" edit={{ speaker: { id: 'speaker', label: 'Unknown speaker 1', profileId: null, suggestedProfileId: null, suggestedName: null, score: null, canRemember: true } }} {...props} />)
    expect(await screen.findByRole('dialog', { name: 'Name this speaker' })).toBeVisible()
    expect(screen.getByLabelText('Speaker name')).toHaveValue('')
    await screen.findByRole('option', { name: 'Dana Lee' })
    fireEvent.change(screen.getByLabelText('Saved voice'), { target: { value: 'dana' } })
    expect(screen.getByLabelText('Speaker name')).toHaveValue('Dana Lee')
    fireEvent.click(screen.getByRole('button', { name: 'Save speaker' }))
    await waitFor(() => expect(window.electronAPI.voices.nameSpeaker).toHaveBeenCalledWith('speaker', 'Dana Lee'))
    expect(props.onSaved).toHaveBeenCalledOnce()
  })
  it('assigns an unidentified segment without pretending it has an enrollable voice', async () => {
    const props = setup()
    render(<SpeakerEditor recordingId="recording" edit={{ segment: { id: 'segment', start: 1, end: 2, text: 'Words', speakerId: null, speakerName: null } }} {...props} />)
    expect(await screen.findByText(/will not train a voice profile/)).toBeVisible()
    fireEvent.change(screen.getByLabelText('Speaker name'), { target: { value: 'Dana' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save speaker' }))
    await waitFor(() => expect(window.electronAPI.voices.assignSegment).toHaveBeenCalledWith('recording', 'segment', 'Dana'))
    expect(window.electronAPI.voices.nameSpeaker).not.toHaveBeenCalled()
  })
  it('keeps unknown names red and named speakers consistently colored', () => {
    for (const label of ['Speaker', 'Speaker 2', 'Unknown speaker 1', 'Unassigned speaker']) expect(speakerColor(label)).toBe('speaker-unknown')
    expect(speakerColor('Dana Lee')).toBe(speakerColor('dana lee'))
    expect(speakerColor('Dana Lee')).not.toBe(speakerColor('Kevin'))
  })
  it('assigns distinct colors to up to ten people even when name hashes collide', () => {
    const names = Array.from({ length: 10 }, (_, index) => `Person ${index}`)
    const colors = speakerColors(names)
    expect(new Set(colors.values()).size).toBe(10)
    expect(speakerColors([...names].reverse())).toEqual(colors)
  })
})
