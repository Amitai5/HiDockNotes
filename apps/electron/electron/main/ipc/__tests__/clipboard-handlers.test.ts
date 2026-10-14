import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerClipboardHandler } from '../clipboard-handlers'

const mocked = vi.hoisted(() => ({ writeText: vi.fn(), handlers: new Map<string, (value: unknown) => void>() }))
vi.mock('electron', () => ({ clipboard: { writeText: mocked.writeText } }))
vi.mock('../trusted-ipc', () => ({ handle: (name: string, callback: (value: unknown) => void) => mocked.handlers.set(name, callback) }))
beforeEach(() => { mocked.writeText.mockReset(); mocked.handlers.clear(); registerClipboardHandler() })

describe('trusted text clipboard boundary', () => {
  it('copies Markdown and Unicode without trimming indentation or newlines', () => {
    const text = '  ## Résumé\n\n    const answer = "你好";\n'
    mocked.handlers.get('app:copy-text')!(text)
    expect(mocked.writeText).toHaveBeenCalledExactlyOnceWith(text)
  })
  it.each([['null', null], ['undefined', undefined], ['number', 42], ['object', {}], ['empty', ''], ['oversized', 'x'.repeat(200001)]])('rejects %s clipboard input without changing the clipboard', (_label, value) => {
    expect(() => mocked.handlers.get('app:copy-text')!(value)).toThrow('Invalid clipboard text')
    expect(mocked.writeText).not.toHaveBeenCalled()
  })
  it('accepts text at the size limit', () => {
    const text = 'x'.repeat(200000)
    mocked.handlers.get('app:copy-text')!(text)
    expect(mocked.writeText).toHaveBeenCalledWith(text)
  })
})
