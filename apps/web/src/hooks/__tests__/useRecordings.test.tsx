import { appClient, setAppClient } from '../../services/app-client'
// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppClient, RecordingView } from '../../shared/contracts'
import { EMPTY_SEMANTIC_STATE, type SearchMode } from '../../shared/semantic-search'
import { useRecordings } from '../useRecordings'

const recording: RecordingView = { id: 'recording', filename: 'meeting.wav', title: 'Meeting', recordedAt: '2026-10-21T10:00:00Z', duration: 60, size: 100, status: 'done', verified: true, hasAudio: true, projectId: null, summary: null }
beforeEach(() => {
  vi.useFakeTimers()
  setAppClient({
    library: { list: vi.fn(async () => [recording]), onChanged: vi.fn(() => vi.fn()) },
    semanticSearch: { search: vi.fn(async () => [recording]), onState: vi.fn(() => vi.fn()) }
  } as unknown as AppClient)
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('Recording search results', () => {
  it('clears old rows immediately and ignores a late response from the previous query', async () => {
    let finishOld!: (rows: RecordingView[]) => void
    const { result, rerender } = renderHook(({ query }) => useRecordings(query), { initialProps: { query: '' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.recordings).toEqual([recording])
    vi.mocked(appClient.library.list).mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
    rerender({ query: 'first question' })
    expect(result.current.loading).toBe(true)
    expect(result.current.recordings).toEqual([])
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    rerender({ query: 'new question' })
    vi.mocked(appClient.library.list).mockResolvedValueOnce([])
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    expect(result.current.loading).toBe(false)
    await act(async () => finishOld([recording]))
    expect(result.current.recordings).toEqual([])
  })

  it('clears semantic results when switching to keywords and retains the selected status', async () => {
    const { result, rerender } = renderHook(({ mode }: { mode: SearchMode }) => useRecordings('cost of borrowing', 'done', mode), { initialProps: { mode: 'meaning' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    expect(appClient.semanticSearch.search).toHaveBeenCalledWith('cost of borrowing', 'done', 'meaning')
    expect(result.current.recordings).toEqual([recording])
    vi.mocked(appClient.library.list).mockResolvedValueOnce([])
    rerender({ mode: 'keywords' })
    expect(result.current.loading).toBe(true)
    expect(result.current.recordings).toEqual([])
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    expect(appClient.library.list).toHaveBeenCalledWith('cost of borrowing', 'done')
    expect(result.current.recordings).toEqual([])
    expect(result.current.loading).toBe(false)
  })

  it('refreshes when indexing finishes and removes its listeners on unmount', async () => {
    const { unmount } = renderHook(() => useRecordings('loan costs', '', 'meaning'))
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    const updated = vi.mocked(appClient.semanticSearch.onState).mock.calls[0][0]
    act(() => updated({ ...EMPTY_SEMANTIC_STATE, phase: 'ready', enabled: true, modelReady: true }))
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    expect(appClient.semanticSearch.search).toHaveBeenCalledTimes(2)
    unmount()
    expect(vi.mocked(appClient.semanticSearch.onState).mock.results[0].value).toHaveBeenCalledOnce()
    expect(vi.mocked(appClient.library.onChanged).mock.results[0].value).toHaveBeenCalledOnce()
  })
})
