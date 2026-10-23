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
