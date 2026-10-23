import { MAX_MEETING_PARTICIPANTS } from '../../../src/shared/meeting'
import { normalizeEmbedding } from './voice-matching'

export interface SpeakerFragment { id: string; vector: number[] | null; weight: number; identity?: string; window?: number; conflicts?: string[] }
export interface SpeakerGroup { root: string; members: string[]; vector: number[] | null; weight: number; identity?: string; windows: Set<number> }
export interface SpeakerGrouping { groups: SpeakerGroup[]; limited: boolean; unassigned: string[] }
const MATCH_SIMILARITY = 0.5

/** Groups repeated recording-local voices; uncertain overflow never becomes a named voice sample. */
export function groupSpeakerFragments(input: SpeakerFragment[], expectedSpeakers?: number): SpeakerGrouping {
  const groups: SpeakerGroup[] = []
  const unassigned: string[] = []
  let limited = false
  if (new Set(input.flatMap(item => item.identity ? [item.identity] : [])).size > MAX_MEETING_PARTICIPANTS) throw new Error('This recording has more than ten confirmed identities. Review the saved speaker names.')
  const fragments = input.map((item, order) => ({ ...item, vector: item.vector ? normalizeEmbedding(item.vector) : null, weight: Math.max(0.01, item.weight), order })).sort((a, b) => Number(!!b.identity) - Number(!!a.identity) || b.weight - a.weight || a.order - b.order)
  for (const item of fragments) {
    // Different local cluster numbers are not proof of different people. The
    // native model can split one voice within a section. Only actual overlapping
    // turns (or two confirmed identities) are a cannot-link constraint.
    const eligible = groups.filter(group => (!item.identity || !group.identity || item.identity === group.identity) && (item.vector !== null || item.window === undefined || !group.windows.has(item.window)) && !group.members.some(member => item.conflicts?.includes(member) || input.find(fragment => fragment.id === member)?.conflicts?.includes(item.id)))
    const scores = eligible.filter(group => group.vector && item.vector && group.vector.length === item.vector.length).map(group => ({ group, score: group.vector!.reduce((sum, value, index) => sum + value * item.vector![index], 0) })).sort((a, b) => b.score - a.score)
    const best = scores[0], margin = scores.length > 1 ? best.score - scores[1].score : 1
    let target = item.identity ? eligible.find(group => group.identity === item.identity) : undefined
    if (!target && best && best.score >= (best.group.identity ? 0.75 : MATCH_SIMILARITY) && margin >= 0.05) target = best.group
    if (!target && !item.vector && !item.identity) target = eligible.find(group => !group.vector && !group.identity)
    if (!target && groups.length < MAX_MEETING_PARTICIPANTS) {
      groups.push({ root: item.id, members: [item.id], vector: item.vector, weight: item.weight, identity: item.identity, windows: new Set(item.window === undefined ? [] : [item.window]) })
      continue
    }
    if (!target) {
      limited = true
      target = groups.find(group => !group.vector && !group.identity) ?? groups.filter(group => !group.identity).sort((a, b) => a.weight - b.weight)[0]
      // All ten groups have confirmed names: retain them and leave ambiguous text unassigned.
      if (!target) { unassigned.push(item.id); continue }
      target.vector = null
    } else if (target.vector && item.vector) {
      target.vector = normalizeEmbedding(target.vector.map((value, index) => (value * target!.weight + item.vector![index] * item.weight) / (target!.weight + item.weight)))
    }
    target.members.push(item.id); target.weight += item.weight
    if (item.identity) target.identity = item.identity
    if (item.window !== undefined) target.windows.add(item.window)
  }
  if (expectedSpeakers !== undefined) {
    if (!Number.isInteger(expectedSpeakers) || expectedSpeakers < 1 || expectedSpeakers > MAX_MEETING_PARTICIPANTS) throw new Error('Choose between one and ten speakers.')
    while (groups.length > expectedSpeakers) {
      let pair: { a: number; b: number; score: number } | undefined
      for (let a = 0; a < groups.length; a++) for (let b = a + 1; b < groups.length; b++) {
        const left = groups[a], right = groups[b]
        if (left.identity && right.identity && left.identity !== right.identity) continue
        if (left.members.some(id => input.find(item => item.id === id)?.conflicts?.some(conflict => right.members.includes(conflict)))) continue
        const score = left.vector && right.vector && left.vector.length === right.vector.length ? left.vector.reduce((sum, value, index) => sum + value * right.vector![index], 0) : -1
        if (!pair || score > pair.score) pair = { a, b, score }
      }
      if (!pair) break
      const left = groups[pair.a], right = groups[pair.b]
      left.vector = left.vector && right.vector ? normalizeEmbedding(left.vector.map((value, index) => value * left.weight + right.vector![index] * right.weight)) : null
      left.members.push(...right.members); left.weight += right.weight; left.identity ??= right.identity
      for (const window of right.windows) left.windows.add(window)
      groups.splice(pair.b, 1)
    }
  }
  return { groups, limited, unassigned }
}
