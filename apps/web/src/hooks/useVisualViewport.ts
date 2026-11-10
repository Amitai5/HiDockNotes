import { useEffect } from 'react'

/** Keeps mobile panes and dialogs inside the space above the on-screen keyboard. */
export function useVisualViewport(): void {
  useEffect(() => {
    const viewport = window.visualViewport, style = document.documentElement.style
    const update = (): void => {
      // Preserve browser pinch zoom; only follow keyboard/browser chrome resizing.
      if (viewport && Math.abs(viewport.scale - 1) > .01) return
      style.setProperty('--visible-height', `${viewport?.height ?? window.innerHeight}px`)
      style.setProperty('--visible-top', `${viewport?.offsetTop ?? 0}px`)
    }
    update(); viewport?.addEventListener('resize', update); viewport?.addEventListener('scroll', update); window.addEventListener('resize', update)
    return () => { viewport?.removeEventListener('resize', update); viewport?.removeEventListener('scroll', update); window.removeEventListener('resize', update); style.removeProperty('--visible-height'); style.removeProperty('--visible-top') }
  }, [])
}
