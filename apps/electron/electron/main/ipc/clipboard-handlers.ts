import { clipboard } from 'electron'
import { handle } from './trusted-ipc'

export function registerClipboardHandler(): void {
  handle('app:copy-text', value => {
    if (typeof value !== 'string' || !value.length || value.length > 200000) throw new Error('Invalid clipboard text.')
    // Preserve Markdown indentation and newlines exactly; never log content.
    clipboard.writeText(value)
  })
}
