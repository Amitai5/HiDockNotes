/** Converts visual pointer coordinates into the shared interface's layout units. */
export function uiScale(): number {
  const value = Number.parseFloat(getComputedStyle(document.documentElement).zoom)
  return Number.isFinite(value) && value > 0 ? value : 1
}
