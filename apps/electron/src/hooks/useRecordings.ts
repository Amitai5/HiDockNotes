import { useCallback, useEffect, useState } from 'react'
import type { RecordingView } from '../shared/contracts'
import { reportError } from '../store/useAppStore'

export function useRecordings(search = '', status = ''): { recordings: RecordingView[]; loading: boolean; refresh(): void } {
  const [recordings, setRecordings] = useState<RecordingView[]>([])
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const refresh = useCallback(() => setRevision(value => value + 1), [])
  useEffect(() => {
    let mounted = true
    const timer = setTimeout(() => {
      setLoading(true)
      void window.electronAPI.library.list(search, status).then(rows => { if (mounted) setRecordings(rows) }).catch(reportError).finally(() => { if (mounted) setLoading(false) })
    }, search ? 200 : 0)
    return () => { mounted = false; clearTimeout(timer) }
  }, [search, status, revision])
  useEffect(() => window.electronAPI.library.onChanged(refresh), [refresh])
  return { recordings, loading, refresh }
}
