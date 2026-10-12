import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { LibraryNavigation } from '../shared/library'
import { reportError } from '../store/useAppStore'

const NavigationContext = createContext<LibraryNavigation>({ projects: [], looseRecordings: [] })

export function LibraryNavigationProvider({ children }: { children: ReactNode }): JSX.Element {
  const [navigation, setNavigation] = useState<LibraryNavigation>({ projects: [], looseRecordings: [] })
  useEffect(() => {
    let mounted = true
    let generation = 0
    let timer: ReturnType<typeof setTimeout>
    const load = (): void => {
      const current = ++generation
      clearTimeout(timer)
      timer = setTimeout(() => {
        void window.electronAPI.library.navigation().then(value => {
          if (mounted && current === generation) setNavigation(value)
        }).catch(reportError)
      }, 75)
    }
    load()
    const unsubscribe = window.electronAPI.library.onChanged(load)
    return () => { mounted = false; clearTimeout(timer); unsubscribe() }
  }, [])
  return <NavigationContext.Provider value={navigation}>{children}</NavigationContext.Provider>
}

export function useLibraryNavigation(): LibraryNavigation { return useContext(NavigationContext) }
