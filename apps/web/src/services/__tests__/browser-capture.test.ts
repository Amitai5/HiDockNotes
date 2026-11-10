import { beforeEach, expect, it, vi } from 'vitest'
import { BrowserCapture, recoverBrowserCaptures } from '../browser-capture'
const http = vi.hoisted(() => ({ request: vi.fn(), response: vi.fn(), clientEvents: new EventTarget() }))
vi.mock('../http', () => http)
const id = '00000000-0000-4000-8000-000000000001'
class FileHandle {
  kind = 'file'; bytes = new Uint8Array()
  constructor(readonly name: string) {}
  async getFile() { return new Blob([this.bytes]) }
  async createWritable() { let data: Uint8Array; return { write: async (value: string | Uint8Array) => { data = typeof value === 'string' ? new TextEncoder().encode(value) : value.slice() }, close: async () => { this.bytes = data ?? new Uint8Array() }, abort: async () => undefined } }
}
class Directory {
  kind = 'directory'; entries = new Map<string, FileHandle | Directory>()
  constructor(readonly name: string) {}
  async getDirectoryHandle(name: string, options?: {create?: boolean}): Promise<Directory> { let item = this.entries.get(name); if (!item && options?.create) { item = new Directory(name); this.entries.set(name,item) }; if (!(item instanceof Directory)) throw new Error('Missing directory'); return item }
  async getFileHandle(name: string, options?: {create?: boolean}): Promise<FileHandle> { let item = this.entries.get(name); if (!item && options?.create) { item = new FileHandle(name); this.entries.set(name,item) }; if (!(item instanceof FileHandle)) throw new Error('Missing file'); return item }
  async removeEntry(name: string) { this.entries.delete(name) }
  async *values() { yield* this.entries.values() }
}
let directory: Directory
beforeEach(() => { directory = new Directory('root'); vi.stubGlobal('navigator',{storage:{getDirectory:async()=>directory}}); http.request.mockReset();http.response.mockReset();http.request.mockImplementation(async path=>path==='/api/v1/captures'?{id}:path.endsWith('/resume')?{id,state:'interrupted',frames:0,bytes:0}:{ok:true});http.response.mockImplementation(async path=>({json:async()=>({frames:Number(path.split('sequence=')[1])+1})})) })
function device() { let receiver: ((value: any)=>void) | undefined; const getRealtimeData=vi.fn(()=>new Promise<any>(resolve=>{receiver=resolve}));return {source:{startRealtime:vi.fn(async()=>({result:'success'})),stopRealtime:vi.fn(async()=>({result:'success'})),getRealtimeData},packet:(size:number)=>{const next=receiver;receiver=undefined;next?.({data:new Uint8Array(size+8),rest:0,muted:false})}} }
it('drains USB into durable chunks while server acknowledgement is slow and waits for it on stop',async()=>{
  const usb=device();let acknowledge!:()=>void;http.response.mockImplementationOnce(()=>new Promise(resolve=>{acknowledge=()=>resolve({json:async()=>({frames:1})})}))
  const capture=new BrowserCapture(usb.source,vi.fn());await capture.start('P1');usb.packet(65536)
  await vi.waitFor(()=>expect(http.response).toHaveBeenCalledTimes(1));expect(usb.source.getRealtimeData).toHaveBeenCalledTimes(2)
  usb.packet(65536);await vi.waitFor(()=>expect(usb.source.getRealtimeData).toHaveBeenCalledTimes(3))
  let finished=false;const stop=capture.stop().then(()=>{finished=true});usb.packet(0);await Promise.resolve();expect(finished).toBe(false);acknowledge();await stop
  expect(http.response).toHaveBeenCalledTimes(2);expect(http.request).toHaveBeenCalledWith('/api/v1/captures/'+id+'/finish',{});expect((await directory.getDirectoryHandle('hidock-captures')).entries.size).toBe(0)
})
it('retains unacknowledged audio after a network failure and uploads it during explicit recovery',async()=>{
  const usb=device();http.response.mockRejectedValueOnce(new Error('Network interrupted'));const capture=new BrowserCapture(usb.source,vi.fn());await capture.start('P1');usb.packet(65536);await vi.waitFor(()=>expect(http.response).toHaveBeenCalledTimes(1));usb.packet(0);await vi.waitFor(()=>expect(capture.active).toBe(false))
  const staged=await (await directory.getDirectoryHandle('hidock-captures')).getDirectoryHandle(id);expect((await (await staged.getFileHandle('00000000.pcm')).getFile()).size).toBe(65536)
  expect(await recoverBrowserCaptures()).toBe(1);expect(http.request).toHaveBeenCalledWith('/api/v1/captures/'+id+'/finish',{})
})
it('rejects malformed PCM instead of silently dropping bytes',async()=>{
  const usb=device(),changed=vi.fn(),capture=new BrowserCapture(usb.source,changed);await capture.start('P1');usb.packet(3);await vi.waitFor(()=>expect(capture.active).toBe(false));expect(changed).toHaveBeenCalledWith(expect.stringContaining('unsupported audio format'));expect(http.request.mock.calls.some(([path])=>path.endsWith('/finish'))).toBe(false)
})

it.each(['interrupted', 'completed'])('retains every browser chunk when a %s capture has a missing chunk', async state => {
  const captures = await directory.getDirectoryHandle('hidock-captures', { create: true }), staged = await captures.getDirectoryHandle(id, { create: true })
  const metadata = await staged.getFileHandle('capture.json', { create: true }); metadata.bytes = new TextEncoder().encode(JSON.stringify({ id, serial: 'P1' }))
  for (const sequence of [0, 2]) { const file = await staged.getFileHandle(String(sequence).padStart(8, '0') + '.pcm', { create: true }); file.bytes = new Uint8Array(64).fill(sequence + 1) }
  http.request.mockImplementation(async path => path.endsWith('/resume') ? { id, state, frames: state === 'completed' ? 2 : 0, bytes: state === 'completed' ? 128 : 0 } : { ok: true })
  await expect(recoverBrowserCaptures()).rejects.toThrow(/missing|incomplete/i)
  expect(captures.entries.has(id)).toBe(true)
  expect(staged.entries.has('00000002.pcm')).toBe(true)
  expect(http.request.mock.calls.some(([path]) => path.endsWith('/finish'))).toBe(false)
})

it('cleans an entirely acknowledged browser capture without uploading its audio twice', async () => {
  const captures = await directory.getDirectoryHandle('hidock-captures', { create: true }), staged = await captures.getDirectoryHandle(id, { create: true })
  const metadata = await staged.getFileHandle('capture.json', { create: true }); metadata.bytes = new TextEncoder().encode(JSON.stringify({ id, serial: 'P1' }))
  const pcm = await staged.getFileHandle('00000000.pcm', { create: true }); pcm.bytes = new Uint8Array(64)
  http.request.mockResolvedValue({ id, state: 'completed', frames: 1, bytes: 64 })
  expect(await recoverBrowserCaptures()).toBe(0)
  expect(captures.entries.size).toBe(0); expect(http.response).not.toHaveBeenCalled()
})

it('keeps a locally saved tail even when its total size is smaller than the completed server prefix', async () => {
  const nextId = '00000000-0000-4000-8000-000000000002', captures = await directory.getDirectoryHandle('hidock-captures', { create: true }), staged = await captures.getDirectoryHandle(id, { create: true })
  const metadata = await staged.getFileHandle('capture.json', { create: true }); metadata.bytes = new TextEncoder().encode(JSON.stringify({ id, serial: 'P1' }))
  for (const [sequence, size] of [[0, 64], [1, 4]]) { const file = await staged.getFileHandle(String(sequence).padStart(8, '0') + '.pcm', { create: true }); file.bytes = new Uint8Array(size) }
  http.request.mockImplementation(async path => path.endsWith('/resume') ? { id, state: 'completed', frames: 1, bytes: 128 } : path === '/api/v1/captures' ? { id: nextId } : { ok: true })
  expect(await recoverBrowserCaptures()).toBe(1)
  expect(http.response.mock.calls.map(([path]) => path)).toEqual(['/api/v1/captures/' + nextId + '?sequence=0', '/api/v1/captures/' + nextId + '?sequence=1'])
  expect(http.request).toHaveBeenCalledWith('/api/v1/captures/' + nextId + '/finish', {})
})
