// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
vi.mock('../hash', () => ({ hashBlob: vi.fn(async () => 'a'.repeat(64)) }))
import { uploadAudio } from '../upload'

const MIB = 1024 * 1024, id = '4f0f1e84-59ce-42de-aa67-c13b916c243c'
let offset: number, size: number, fetcher: ReturnType<typeof vi.fn>
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
const status = () => ({ id, offset, recording_id: null })
function blob(bytes: number): Blob { size = bytes; return new Blob([new Uint8Array(bytes).fill(19)]) }
beforeEach(() => {
  vi.useFakeTimers(); offset = 0; size = 0
  fetcher = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === '/api/v1/uploads') return json(status())
    if (path.endsWith('/complete')) return json({ recording_id: 'recording' })
    if (init?.method === 'PUT') { offset += (init.body as Blob).size; return json(status()) }
    return json(status())
  })
  vi.stubGlobal('fetch', fetcher)
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })
const puts = () => fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT')
const completes = () => fetcher.mock.calls.filter(([path]) => path.endsWith('/complete'))

it('uploads sequential 4 MiB chunks and an exact final tail, then verifies the whole recording', async () => {
  const progress = vi.fn(), verifying = vi.fn(), controller = new AbortController()
  expect(await uploadAudio(blob(10 * MIB + 17), { filename: 'meeting.hda' }, progress, controller.signal, verifying)).toBe('recording')
  expect(puts().map(([, init]) => (init.body as Blob).size)).toEqual([4 * MIB, 4 * MIB, 2 * MIB + 17])
  expect(puts().map(([path]) => new URL(path, 'https://test').searchParams.get('offset'))).toEqual(['0', String(4 * MIB), String(8 * MIB)])
  for (const [, init] of puts()) expect(new Uint8Array(await (init.body as Blob).arrayBuffer()).every(byte => byte === 19)).toBe(true)
  expect(progress.mock.calls.map(([bytes]) => bytes)).toEqual([0, 4 * MIB, 8 * MIB, size])
  expect(verifying).toHaveBeenCalledOnce(); expect(completes()).toHaveLength(1)
  expect(fetcher.mock.calls.every(([, init]) => init.signal === controller.signal)).toBe(true)
})

it('does not request the next chunk while the current chunk is unacknowledged', async () => {
  let release!: () => void, started!: () => void
  const waiting = new Promise<void>(resolve => { started = resolve }), blocked = new Promise<void>(resolve => { release = resolve })
  const normal = fetcher.getMockImplementation()!
  fetcher.mockImplementation(async (path, init) => { if (init?.method === 'PUT' && offset === 0) { started(); await blocked }; return normal(path, init) })
  const task = uploadAudio(blob(5 * MIB), { filename: 'meeting.hda' })
  await waiting
  expect(puts()).toHaveLength(1); expect(completes()).toHaveLength(0)
  release(); expect(await task).toBe('recording'); expect(puts()).toHaveLength(2)
})

it('resumes from the durable offset when a chunk committed but its acknowledgement was lost', async () => {
  const normal = fetcher.getMockImplementation()!
  let lost = false
  fetcher.mockImplementation(async (path, init) => { if (init?.method === 'PUT' && !lost) { lost = true; offset += (init.body as Blob).size; throw new TypeError('Network request failed') }; return normal(path, init) })
  const task = uploadAudio(blob(5 * MIB), { filename: 'meeting.hda' })
  await vi.runAllTimersAsync(); expect(await task).toBe('recording')
  expect(puts().map(([path]) => new URL(path, 'https://test').searchParams.get('offset'))).toEqual(['0', String(4 * MIB)])
  expect(fetcher.mock.calls.some(([path, init]) => path.endsWith(id) && !init.method)).toBe(true)
})

it.each([409, 429, 503])('rechecks the committed offset and retries an uncommitted chunk after HTTP %s', async code => {
  const normal = fetcher.getMockImplementation()!
  let failed = false
  fetcher.mockImplementation(async (path, init) => { if (init?.method === 'PUT' && !failed) { failed = true; return json({ error: 'Retry later' }, code) }; return normal(path, init) })
  const task = uploadAudio(blob(10), { filename: 'meeting.hda' })
  await vi.runAllTimersAsync(); expect(await task).toBe('recording')
  expect(puts()).toHaveLength(2); expect(offset).toBe(10); expect(completes()).toHaveLength(1)
})

it('preserves the upload request identity when retrying creation and retries completion idempotently', async () => {
  const normal = fetcher.getMockImplementation()!
  let created = false, finished = false
  fetcher.mockImplementation(async (path, init) => {
    if (path === '/api/v1/uploads' && !created) { created = true; throw new TypeError('Response lost') }
    if (path.endsWith('/complete') && !finished) { finished = true; throw new TypeError('Response lost') }
    return normal(path, init)
  })
  const task = uploadAudio(blob(10), { filename: 'meeting.hda', projectId: 'project' })
  await vi.runAllTimersAsync(); expect(await task).toBe('recording')
  const creations = fetcher.mock.calls.filter(([path]) => path === '/api/v1/uploads').map(([, init]) => JSON.parse(String(init.body)))
  expect(creations).toHaveLength(2); expect(creations[0]).toEqual(creations[1]); expect(creations[0].requestId).toMatch(/^[a-f0-9-]{36}$/)
  expect(completes()).toHaveLength(2); expect(puts()).toHaveLength(1)
})

it('bounds transient retries and never completes unacknowledged audio', async () => {
  const normal = fetcher.getMockImplementation()!
  fetcher.mockImplementation((path, init) => init?.method === 'PUT' ? Promise.resolve(json({ error: 'Offline' }, 503)) : normal(path, init))
  const task = uploadAudio(blob(10), { filename: 'meeting.hda' }), rejected = expect(task).rejects.toThrow('Offline')
  await vi.runAllTimersAsync(); await rejected
  expect(puts()).toHaveLength(4); expect(completes()).toHaveLength(0)
})

it('does not retry authentication failures', async () => {
  fetcher.mockResolvedValue(json({ error: 'Sign in again' }, 401))
  await expect(uploadAudio(blob(10), { filename: 'meeting.hda' })).rejects.toThrow('Sign in again')
  expect(fetcher).toHaveBeenCalledOnce()
})

it('cancels a pending retry immediately without sending another chunk or completing', async () => {
  const controller = new AbortController(), normal = fetcher.getMockImplementation()!
  fetcher.mockImplementation((path, init) => init?.method === 'PUT' ? Promise.resolve(json({ error: 'Offline' }, 503)) : normal(path, init))
  const task = uploadAudio(blob(10), { filename: 'meeting.hda' }, vi.fn(), controller.signal), rejected = expect(task).rejects.toThrow()
  await vi.advanceTimersByTimeAsync(1); expect(puts()).toHaveLength(1)
  controller.abort(); await rejected; await vi.runAllTimersAsync()
  expect(puts()).toHaveLength(1); expect(completes()).toHaveLength(0)
})

it('rejects an invalid or non-advancing server offset rather than looping or skipping audio', async () => {
  const normal = fetcher.getMockImplementation()!
  fetcher.mockImplementation((path, init) => init?.method === 'PUT' ? Promise.resolve(json(status())) : normal(path, init))
  await expect(uploadAudio(blob(10), { filename: 'meeting.hda' })).rejects.toThrow('did not confirm')
  expect(puts()).toHaveLength(1); expect(completes()).toHaveLength(0)
})

it('can finish an already uploaded recording without sending its audio again', async () => {
  const audio = blob(10); offset = audio.size
  expect(await uploadAudio(audio, { filename: 'meeting.hda' })).toBe('recording')
  expect(puts()).toHaveLength(0); expect(completes()).toHaveLength(1)
})

it('falls back to 1 MiB chunks if an older server rejects the 4 MiB request', async () => {
  const normal = fetcher.getMockImplementation()!
  fetcher.mockImplementation((path, init) => init?.method === 'PUT' && (init.body as Blob).size > MIB ? Promise.resolve(json({ error: 'Too large' }, 413)) : normal(path, init))
  expect(await uploadAudio(blob(5 * MIB), { filename: 'meeting.hda' })).toBe('recording')
  expect(puts().map(([, init]) => (init.body as Blob).size)).toEqual([4 * MIB, MIB, MIB, MIB, MIB, MIB])
  expect(offset).toBe(size)
})
