// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { sanitizeNotePaste } from '../note-paste'
describe('written-note clipboard boundary', () => {
  it('strips active content, event attributes, styles, and pasted block identities', () => {
    const html = sanitizeNotePaste('<h1 data-block-id="copied" onclick="alert(1)" style="color:red">Hello</h1><p><img src=x onerror=alert(1)><script>bad()</script><strong>bold</strong></p><iframe src=x></iframe>')
    expect(html).toBe('<h1>Hello</h1><p><strong>bold</strong></p>')
  })
  it('preserves nested lists and task state while rejecting unsafe link targets', () => {
    const html = sanitizeNotePaste('<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Done <a href="javascript:alert(1)">unsafe</a></p><ul><li><p>Nested</p></li></ul></li></ul><a href="https://example.com/a" target="bad">safe</a>')
    expect(html).toContain('data-checked="true"'); expect(html).toContain('<ul><li><p>Nested</p></li></ul>'); expect(html).not.toContain('javascript'); expect(html).not.toContain('target='); expect(html).toContain('<a href="https://example.com/a">safe</a>')
  })
})
