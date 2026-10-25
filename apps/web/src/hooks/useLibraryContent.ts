import { useCallback, useEffect, useRef, useState } from 'react'
import { appClient } from '../services/app-client'
import type { LibraryContentOptions, LibraryContentPage } from '../shared/library'

export function useLibraryContent(options: LibraryContentOptions) {
  const key = JSON.stringify(options), request = useRef(0)
  const [page, setPage] = useState<LibraryContentPage>({ items: [], total: 0, nextCursor: null })
  const [loading, setLoading] = useState(true), [error, setError] = useState('')
  const load = useCallback(async (cursor?: string | null) => {
    const generation = ++request.current; setLoading(true); setError('')
    try { const result = await appClient.library.content({ ...JSON.parse(key) as LibraryContentOptions, cursor }); if (generation === request.current) setPage(previous => ({ ...result, items: cursor ? [...previous.items, ...result.items.filter(item => !previous.items.some(old => old.kind === item.kind && old.id === item.id))] : result.items })) }
    catch (value) { if (generation === request.current) setError(value instanceof Error ? value.message : 'The library could not be loaded.') }
    finally { if (generation === request.current) setLoading(false) }
  }, [key])
  useEffect(() => {
    setPage({ items: [], total: 0, nextCursor: null }); void load()
    let timer: ReturnType<typeof setTimeout>
    const refresh = (): void => { clearTimeout(timer); timer = setTimeout(() => { void load() }, 100) }
    const off = appClient.library.onChanged(refresh)
    return () => { ++request.current; clearTimeout(timer); off() }
  }, [load])
  return { ...page, loading, error, retry: () => load(), more: () => load(page.nextCursor) }
}
