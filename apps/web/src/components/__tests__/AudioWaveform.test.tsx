// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AudioWaveform } from '../AudioWaveform'

afterEach(cleanup)
it('supports bounded keyboard seeking and pointer changes with the same accessible control', () => {
  const seek = vi.fn()
  render(<AudioWaveform peaks={[.1, .5, .8]} duration={20} position={18} onSeek={seek} />)
  const control = screen.getByRole('slider', { name: 'Seek in recording' })
  fireEvent.keyDown(control, { key: 'ArrowRight' }); expect(seek).toHaveBeenLastCalledWith(20)
  fireEvent.keyDown(control, { key: 'Home' }); expect(seek).toHaveBeenLastCalledWith(0)
  fireEvent.change(control, { target: { value: '4.5' } }); expect(seek).toHaveBeenLastCalledWith(4.5)
})
it('keeps the seek control disabled until a usable duration is known', () => {
  render(<AudioWaveform peaks={null} duration={0} position={0} onSeek={vi.fn()} label="Seek source recording" />)
  expect(screen.getByRole('slider', { name: 'Seek source recording' })).toBeDisabled()
})
