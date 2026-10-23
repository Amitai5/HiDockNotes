import { setAppClient } from '../../services/app-client'
// Adapted from sgeraldes/hidock-next-2 @ 31d44da (MIT).
// @vitest-environment jsdom

/**
 * Unit tests for useDevicePipeline (Slice 4 renderer hook).
 *
 * MOCK-ONLY — appClient.devicePipeline is hand-rolled. Verifies:
 *  - On mount the hook reads get-state / get-files.
 *  - It subscribes to onState / onFiles and updates local state on push.
 *  - It unsubscribes on unmount.
 *  - Action wrappers delegate to the corresponding bridge method.
 *  - It degrades gracefully when the bridge is unavailable.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useDevicePipeline } from '../useDevicePipeline'

type StateCb = (s: any) => void
type FilesCb = (f: any[]) => void

function makeBridge() {
  let stateCb: StateCb | null = null
  let filesCb: FilesCb | null = null
  const unsubState = vi.fn()
  const unsubFiles = vi.fn()

  const bridge = {
    getState: vi.fn().mockResolvedValue({
      phase: 'connecting',
      device: null,
      scanProgress: null,
      downloadProgress: null,
      error: null,
    }),
    getFiles: vi.fn().mockResolvedValue([{ name: 'init.hda' }]),
    connect: vi.fn().mockResolvedValue(true),
    disconnect: vi.fn().mockResolvedValue(undefined),
    sync: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    deleteFile: vi.fn().mockResolvedValue({ result: 'success' }),
    format: vi.fn().mockResolvedValue({ result: 'success' }),
    onState: vi.fn((cb: StateCb) => {
      stateCb = cb
      return unsubState
    }),
    onFiles: vi.fn((cb: FilesCb) => {
      filesCb = cb
      return unsubFiles
    }),
  }

  return {
    bridge,
    unsubState,
    unsubFiles,
    emitState: (s: any) => stateCb?.(s),
    emitFiles: (f: any[]) => filesCb?.(f),
  }
}

describe('useDevicePipeline', () => {
  afterEach(() => {
    setAppClient(undefined as any)
    vi.clearAllMocks()
  })

  it('reads initial state + files on mount', async () => {
    const { bridge } = makeBridge()
    setAppClient({ devicePipeline: bridge } as any)

    const { result } = renderHook(() => useDevicePipeline())

    await waitFor(() => expect(result.current.state.phase).toBe('connecting'))
    expect(bridge.getState).toHaveBeenCalledTimes(1)
    expect(bridge.getFiles).toHaveBeenCalledTimes(1)
    expect(result.current.files).toEqual([{ name: 'init.hda' }])
  })

  it('subscribes to onState / onFiles', async () => {
    const { bridge } = makeBridge()
    setAppClient({ devicePipeline: bridge } as any)

    const { result } = renderHook(() => useDevicePipeline())

    expect(bridge.onState).toHaveBeenCalledTimes(1)
    expect(bridge.onFiles).toHaveBeenCalledTimes(1)
    // Let the mount-time getState/getFiles promises settle to avoid act() warnings.
    await waitFor(() => expect(result.current.state.phase).toBe('connecting'))
  })

  it('updates state when onState fires', async () => {
    const harness = makeBridge()
    setAppClient({ devicePipeline: harness.bridge } as any)

    const { result } = renderHook(() => useDevicePipeline())
    await waitFor(() => expect(result.current.state.phase).toBe('connecting'))

    act(() => {
      harness.emitState({
        phase: 'downloading',
        device: null,
        scanProgress: null,
        downloadProgress: { filename: 'x.hda', current: 1, total: 1, bytesDownloaded: 5, totalBytes: 10, eta: null },
        error: null,
      })
    })

    expect(result.current.state.phase).toBe('downloading')
    expect(result.current.state.downloadProgress?.filename).toBe('x.hda')
  })

  it('updates files when onFiles fires', async () => {
    const harness = makeBridge()
    setAppClient({ devicePipeline: harness.bridge } as any)

    const { result } = renderHook(() => useDevicePipeline())
    await waitFor(() => expect(result.current.files).toEqual([{ name: 'init.hda' }]))

    act(() => {
      harness.emitFiles([{ name: 'a.hda' }, { name: 'b.hda' }])
    })

    expect(result.current.files).toEqual([{ name: 'a.hda' }, { name: 'b.hda' }])
  })

  it('unsubscribes on unmount', () => {
    const harness = makeBridge()
    setAppClient({ devicePipeline: harness.bridge } as any)

    const { unmount } = renderHook(() => useDevicePipeline())
    unmount()

    expect(harness.unsubState).toHaveBeenCalledTimes(1)
    expect(harness.unsubFiles).toHaveBeenCalledTimes(1)
  })

  it('action wrappers delegate to the bridge', async () => {
    const { bridge } = makeBridge()
    setAppClient({ devicePipeline: bridge } as any)

    const { result } = renderHook(() => useDevicePipeline())

    await act(async () => {
      await result.current.connect()
      await result.current.disconnect()
      await result.current.sync()
      await result.current.cancel()
      await result.current.deleteFile('z.hda', true)
    })

    expect(bridge.connect).toHaveBeenCalledTimes(1)
    expect(bridge.disconnect).toHaveBeenCalledTimes(1)
    expect(bridge.sync).toHaveBeenCalledTimes(1)
    expect(bridge.cancel).toHaveBeenCalledTimes(1)
    expect(bridge.deleteFile).toHaveBeenCalledWith('z.hda', true)
    expect('format' in result.current).toBe(false)
  })

  it('degrades gracefully when the bridge is unavailable', async () => {
    setAppClient(undefined as any)

    const { result } = renderHook(() => useDevicePipeline())

    // Falls back to the initial disconnected state, no throw.
    expect(result.current.state.phase).toBe('disconnected')
    expect(result.current.files).toEqual([])
    await expect(result.current.connect()).resolves.toBe(false)
    await expect(result.current.deleteFile('x')).resolves.toBeNull()
  })
})
