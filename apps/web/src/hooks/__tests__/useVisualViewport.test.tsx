// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useVisualViewport } from '../useVisualViewport'

const original = Object.getOwnPropertyDescriptor(window, 'visualViewport')
afterEach(() => { cleanup(); if (original) Object.defineProperty(window, 'visualViewport', original); else Reflect.deleteProperty(window, 'visualViewport') })
function viewport() { const value = Object.assign(new EventTarget(), { height: 800, offsetTop: 0, scale: 1 }); Object.defineProperty(window, 'visualViewport', { configurable: true, value }); return value }
it('tracks keyboard height and scroll offset and restores full height after dismissal', () => {
  const value = viewport()
  renderHook(useVisualViewport)
  const style = document.documentElement.style
  expect(style.getPropertyValue('--visible-height')).toBe('800px')
  act(() => { value.height = 420; value.offsetTop = 38; value.dispatchEvent(new Event('resize')) })
  expect(style.getPropertyValue('--visible-height')).toBe('420px')
  expect(style.getPropertyValue('--visible-top')).toBe('38px')
  act(() => { value.height = 800; value.offsetTop = 0; value.dispatchEvent(new Event('scroll')) })
  expect(style.getPropertyValue('--visible-height')).toBe('800px')
  expect(style.getPropertyValue('--visible-top')).toBe('0px')
})
it('preserves browser pinch zoom and removes all viewport listeners on unmount', () => {
  const value = viewport(), view = renderHook(useVisualViewport), style = document.documentElement.style
  act(() => { value.scale = 2; value.height = 400; value.dispatchEvent(new Event('resize')) })
  expect(style.getPropertyValue('--visible-height')).toBe('800px')
  act(() => { value.scale = 1; value.height = 700; window.dispatchEvent(new Event('resize')) })
  expect(style.getPropertyValue('--visible-height')).toBe('700px')
  view.unmount()
  value.dispatchEvent(new Event('resize')); value.dispatchEvent(new Event('scroll')); window.dispatchEvent(new Event('resize'))
  expect(style.getPropertyValue('--visible-height')).toBe('')
  expect(style.getPropertyValue('--visible-top')).toBe('')
})
it('uses window dimensions when VisualViewport is unavailable', () => {
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined })
  renderHook(useVisualViewport)
  expect(document.documentElement.style.getPropertyValue('--visible-height')).toBe(`${window.innerHeight}px`)
})
