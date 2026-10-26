/** Applies the shared display limit to AI-generated recording titles. */
export function conciseRecordingTitle(value: string): string {
  const title = value.trim().split(/\s+/u).slice(0, 6).join(' ')
  if (Array.from(title).length <= 60) return title
  const prefix = Array.from(title).slice(0, 60).join('')
  return prefix.replace(/\s+\S*$/u, '') || prefix
}
