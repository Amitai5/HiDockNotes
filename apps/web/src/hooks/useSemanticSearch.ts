import { appClient } from '../services/app-client'
import { useEffect, useState } from 'react'
import { EMPTY_SEMANTIC_STATE, type SemanticSearchState } from '../shared/semantic-search'
import { reportError } from '../store/useAppStore'

export function useSemanticSearch(): SemanticSearchState {
  const [state, setState] = useState<SemanticSearchState>(EMPTY_SEMANTIC_STATE)
  useEffect(() => {
    const api = appClient.semanticSearch
    if (!api) return
    let mounted = true
    void api.state().then(value => { if (mounted) setState(value) }).catch(reportError)
    const off = api.onState(value => { if (mounted) setState(value) })
    return () => { mounted = false; off() }
  }, [])
  return state
}
