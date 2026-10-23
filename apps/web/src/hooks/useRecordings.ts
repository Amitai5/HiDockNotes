import { appClient } from '../services/app-client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { RecordingView } from '../shared/contracts'
import { reportError } from '../store/useAppStore'
import type { SearchMode } from '../shared/semantic-search'

export function useRecordings(search = '', status = '', mode: SearchMode = 'keywords'): { recordings: RecordingView[]; loading: boolean; refresh(): void } {
  const [recordings, setRecordings] = useState<RecordingView[]>([])
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const previousQuery = useRef<string | null>(null)
  const refresh = useCallback(() => setRevision(value => value + 1), [])
  useEffect(() => {
    let mounted = true
    const key = JSON.stringify([search, status, mode])
    setLoading(true)
    if (previousQuery.current !== key) { previousQuery.current = key; setRecordings([]) }
    const timer = setTimeout(() => {
      setLoading(true)
      const request = mode === 'meaning' && search.trim() ? appClient.semanticSearch.search(search, status, mode) : appClient.library.list(search, status)
      void request.then(rows => { if (mounted) setRecordings(rows) }).catch(error => { if (mounted) { setRecordings([]); reportError(error) } }).finally(() => { if (mounted) setLoading(false) })
    }, search ? 200 : 0)
    return () => { mounted = false; clearTimeout(timer) }
  }, [search, status, mode, revision])
  useEffect(() => appClient.library.onChanged(refresh), [refresh])
  useEffect(() => mode === 'meaning' ? appClient.semanticSearch.onState(state => { if (state.phase === 'ready') refresh() }) : undefined, [mode, refresh])
  return { recordings, loading, refresh }
}
