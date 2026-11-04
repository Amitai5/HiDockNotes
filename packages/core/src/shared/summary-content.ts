/** Omits the retired generated task section without changing saved historical notes. */
export function withoutActionItems(markdown: string): string {
  const result: string[] = []
  let omittedDepth = 0, fence: { character: string; length: number } | null = null
  for (const line of markdown.split(/\r?\n/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (marker) {
      if (!fence) fence = { character: marker[0], length: marker.length }
      else if (marker[0] === fence.character && marker.length >= fence.length) fence = null
      if (!omittedDepth) result.push(line)
      continue
    }
    const heading = !fence && /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (heading) {
      const depth = heading[1].length
      if (omittedDepth && depth <= omittedDepth) omittedDepth = 0
      if (!omittedDepth && /^action\s+items\s*[:—-]?$/i.test(heading[2].replace(/[*_`]/g, '').trim())) omittedDepth = depth
    }
    if (!omittedDepth) result.push(line)
  }
  return result.join('\n').trim()
}
