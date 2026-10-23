// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { copyText } from '../clipboard'

afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); delete (navigator as { clipboard?: Clipboard }).clipboard; delete (document as { execCommand?: unknown }).execCommand })

it('uses the asynchronous clipboard when the browser provides it', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  await copyText('Complete answer')
  expect(writeText).toHaveBeenCalledWith('Complete answer')
  expect(document.querySelector('textarea')).toBeNull()
})

it('copies on HTTP without the clipboard API and restores the focused control', async () => {
  const button = document.createElement('button'); document.body.appendChild(button); button.focus()
  const exec = vi.fn(() => { expect((document.activeElement as HTMLTextAreaElement).value).toBe('Local answer'); return true })
  Object.defineProperty(document, 'execCommand', { configurable: true, value: exec })
  await copyText('Local answer')
  expect(exec).toHaveBeenCalledWith('copy')
  expect(document.activeElement).toBe(button)
  expect(document.querySelector('textarea')).toBeNull()
})

it('reports a denied fallback copy and removes its temporary field', async () => {
  Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false })
  await expect(copyText('Local answer')).rejects.toThrow('Copy was blocked')
  expect(document.querySelector('textarea')).toBeNull()
})
