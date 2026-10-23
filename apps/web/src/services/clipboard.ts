/** Copy also works on explicitly configured local HTTP addresses. */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return }
  const focused = document.activeElement, selection = document.getSelection()
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : []
  const field = document.createElement('textarea')
  field.value = text; field.readOnly = true
  field.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none'
  document.body.appendChild(field)
  try {
    field.focus({ preventScroll: true }); field.select()
    if (!document.execCommand?.('copy')) throw new Error('Copy was blocked by your browser. Select and copy the text, or open the HTTPS address.')
  } finally {
    field.remove()
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true })
    if (selection) { selection.removeAllRanges(); for (const range of ranges) selection.addRange(range) }
  }
}
