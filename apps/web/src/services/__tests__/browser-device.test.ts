// @vitest-environment jsdom
import { Blob as NodeBlob } from 'node:buffer'
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({ devices: [] as any[], invoke: vi.fn(), request: vi.fn(), calls: [] as string[], files: [] as any[], active: null as string | null, upload: vi.fn() }))
vi.mock('../http', () => ({ clientEvents: new EventTarget(), invoke: fake.invoke, request: fake.request, response: vi.fn() }))
vi.mock('../upload', () => ({ uploadAudio: fake.upload }))
vi.mock('@hidock/jensen-protocol', () => ({ USB_VENDOR_IDS: [0x10d6,0x3887], supportsRealtimeFirmware: () => true, JensenDevice: class {
  connected = false
  constructor() { fake.devices.push(this) }
  tryConnect = vi.fn(async () => { this.connected=true;return true })
  isConnected = () => this.connected
  getDeviceInfo = async () => ({serialNumber:'P1-original',model:'hidock-p1',versionCode:'1.3',versionNumber:66312})
  getCardInfo = async () => null
  getSettings = async () => ({autoRecord:false})
  getBatteryStatus = async () => null
  getRecordingFile = async () => ({recording:fake.active})
  listFiles = vi.fn(async () => fake.files.map(file => ({ ...file })))
  downloadFile = vi.fn(async (_name, length, chunk, progress, signal) => { signal?.throwIfAborted(); chunk(new Uint8Array(length)); progress(25); progress(75); progress(length); return true })
  getActiveDownloadSettlement = vi.fn(async () => undefined)
  disconnect = vi.fn(async () => { this.connected=false })
  deleteFile = vi.fn(async () => ({result:'success'}))
} }))
import { BrowserDevice, usbAvailability } from '../browser-device'
let held = false, picker: ReturnType<typeof vi.fn>
beforeEach(() => { held=false;fake.calls.length=0;fake.active=null;fake.files=[{name:'meeting.hda',length:100,time:new Date('2026-10-01'),duration:10,signature:'source',createDate:'20261001',createTime:'100000',version:1}];fake.upload.mockReset().mockImplementation(async (_blob,_metadata,progress,_signal,verifying)=>{progress(50);progress(100);verifying?.();return 'server-recording'});vi.stubGlobal('crypto',webcrypto);Object.defineProperty(navigator,'storage',{configurable:true,value:{getDirectory:async()=>storage,estimate:async()=>({quota:10**9,usage:0})}});storage=new Directory();fake.request.mockResolvedValue({recordings:[],commands:[]});fake.invoke.mockResolvedValue({autoDownload:false});picker=vi.fn(()=>{fake.calls.push('picker');return Promise.resolve({vendorId:0x10d6})});vi.stubGlobal('isSecureContext',true);Object.defineProperty(window,'isSecureContext',{configurable:true,value:true});Object.defineProperty(navigator,'usb',{configurable:true,value:{requestDevice:picker,getDevices:async()=>[],addEventListener:vi.fn()}});Object.defineProperty(navigator,'locks',{configurable:true,value:{request:vi.fn(async (_name:string,_options:unknown,callback:(lock:unknown)=>Promise<void>)=>{fake.calls.push('lock');if(held)return callback(null);held=true;try{return await callback({})}finally{held=false}})}}) })
afterEach(()=>vi.unstubAllGlobals())
it('opens the permission picker directly from the user action before asynchronous ownership checks',async()=>{const client=new BrowserDevice(),connected=client.connect();expect(picker).toHaveBeenCalledOnce();expect(fake.calls[0]).toBe('picker');await connected;expect((await client.api.getState()).device?.serialNumber).toBe('P1-original');await client.disconnect()})
it('keeps a second tab from claiming a device already owned by the first tab',async()=>{const first=new BrowserDevice(),second=new BrowserDevice();await first.connect();await expect(second.connect()).rejects.toThrow('Another HiDockNotes');expect((await first.api.getState()).phase).toBe('idle');await first.disconnect();await expect(second.connect()).resolves.toBe(true);await second.disconnect()})
it('waits for transfer drain before closing the USB handle or releasing ownership',async()=>{const client=new BrowserDevice();await client.connect();const native=fake.devices.at(-1);let drain!:()=>void;native.getActiveDownloadSettlement.mockReturnValue(new Promise<void>(resolve=>{drain=resolve}));const disconnected=client.disconnect();await Promise.resolve();expect(native.disconnect).not.toHaveBeenCalled();expect(held).toBe(true);drain();await disconnected;expect(native.disconnect).toHaveBeenCalledOnce();expect(held).toBe(false)})
it('never deletes a recorder file without a matching verified server copy',async()=>{const client=new BrowserDevice();await client.connect();await expect(client.deleteFile('meeting.hda',true)).rejects.toThrow('matching verified server copy');expect(fake.devices.at(-1).deleteFile).not.toHaveBeenCalled();await client.disconnect()})
it('explains insecure origins before asking for device permission',async()=>{Object.defineProperty(window,'isSecureContext',{configurable:true,value:false});const client=new BrowserDevice();expect(usbAvailability()).toContain('HTTPS');await expect(client.connect()).rejects.toThrow('HTTPS');expect(picker).not.toHaveBeenCalled()})

class FileHandle {
  bytes = new Uint8Array()
  async getFile() { return new NodeBlob([this.bytes]) }
  async createWritable() { let parts: Uint8Array[] = []; return { write: async (bytes: Uint8Array) => { parts.push(bytes.slice()) }, close: async () => { this.bytes = new Uint8Array(parts.reduce((total,part)=>total+part.length,0)); let offset=0;for(const part of parts){this.bytes.set(part,offset);offset+=part.length} }, abort: async () => { parts=[] } } }
}
class Directory {
  entries = new Map<string,FileHandle>()
  async getDirectoryHandle() { return this }
  async getFileHandle(name: string, options?: {create?:boolean}) { if (!this.entries.has(name) && options?.create) this.entries.set(name,new FileHandle()); const item=this.entries.get(name);if(!item)throw Error('Missing');return item }
  async removeEntry(name: string) { this.entries.delete(name) }
}
let storage: Directory
const copy = {filename:'meeting.hda',size:100,checksum:'a'.repeat(64)}
function verified() { fake.request.mockImplementation(async (path:string) => path.includes('/manifest?') ? {recordings:[copy],commands:[]} : {verified:true}) }
it('does not download new files on connect, refresh or an automatic request while auto-download is off',async()=>{
  const client=new BrowserDevice();await client.connect();await client.sync();await client.download(['meeting.hda'],true)
  expect(fake.devices.at(-1).downloadFile).not.toHaveBeenCalled();expect(fake.upload).not.toHaveBeenCalled();await client.disconnect()
})
it('allows a manual download with automatic downloading disabled and publishes fresh percentage snapshots for USB and upload',async()=>{
  const client=new BrowserDevice();await client.connect();const changes:any[]=[],state:any[]=[];client.api.onDownloads(value=>changes.push(value));client.api.onState(value=>state.push(value));await client.download(['meeting.hda'])
  expect(changes.some(value=>value.queue[0].status==='downloading'&&value.queue[0].progress===25)).toBe(true)
  expect(changes.some(value=>value.queue[0].status==='downloading'&&value.queue[0].progress===75)).toBe(true)
  expect(changes.some(value=>value.queue[0].status==='uploading'&&value.queue[0].progress===50)).toBe(true)
  expect(changes.some(value=>value.queue[0].status==='verifying')).toBe(true)
  expect(new Set(changes.map(value=>value.queue)).size).toBe(changes.length)
  expect(state.some(value=>value.downloadProgress?.bytesDownloaded===25)).toBe(true)
  expect((await client.api.getFiles())[0].localVerified).toBe(true);expect(fake.devices.at(-1).deleteFile).not.toHaveBeenCalled();await client.disconnect()
})
it('cancels the active automatic transfer when disabled and never starts the next recording',async()=>{
  const client=new BrowserDevice();await client.connect();fake.files.push({...fake.files[0],name:'second.hda'});await client.sync();fake.invoke.mockResolvedValue({autoDownload:true})
  const native=fake.devices.at(-1);let begin!:()=>void;const started=new Promise<void>(resolve=>{begin=resolve});native.downloadFile.mockImplementationOnce(async (_name,_size,_chunk,_progress,signal)=>{begin();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))})
  const task=client.download(['meeting.hda','second.hda'],true);await started;client.applySettings({autoDownload:false});await task
  expect(native.downloadFile).toHaveBeenCalledTimes(1);expect(fake.upload).not.toHaveBeenCalled();expect((await client.api.getDownloads()).queue.every(item=>item.status==='cancelled')).toBe(true);expect((await client.api.getState()).error).toBeNull();await client.disconnect()
})
it('rechecks auto-download before every queued automatic file',async()=>{
  const client=new BrowserDevice();await client.connect();fake.files.push({...fake.files[0],name:'second.hda'});await client.sync();fake.invoke.mockResolvedValue({autoDownload:true});fake.upload.mockImplementationOnce(async()=>{fake.invoke.mockResolvedValue({autoDownload:false});return 'saved'})
  await client.download(['meeting.hda','second.hda'],true);expect(fake.devices.at(-1).downloadFile).toHaveBeenCalledTimes(1);expect((await client.api.getDownloads()).queue[1].status).toBe('cancelled');await client.disconnect()
})
it('keeps a pending auto-download opt-out authoritative while the server still reports the old value',async()=>{
  const client=new BrowserDevice();await client.connect();client.suspendAutomaticDownloads();fake.invoke.mockResolvedValue({autoDownload:true});await client.sync();expect(fake.devices.at(-1).downloadFile).not.toHaveBeenCalled();client.resumeAutomaticDownloads();await client.disconnect()
})
it('deletes a verified device copy without downloading or showing transfer progress',async()=>{
  verified();const client=new BrowserDevice();await client.connect();const updates:any[]=[];client.api.onState(value=>updates.push(value));await expect(client.deleteFile('meeting.hda',true)).resolves.toEqual({result:'success'})
  expect(fake.devices.at(-1).downloadFile).not.toHaveBeenCalled();expect(fake.upload).not.toHaveBeenCalled();expect(updates.every(value=>value.downloadProgress===null)).toBe(true);expect(fake.request).toHaveBeenCalledWith('/api/v1/device/verify-copy',expect.objectContaining({serial:'P1-original',...copy}));expect(await client.api.getFiles()).toEqual([]);await client.disconnect()
})
it('keeps device audio if server verification fails or the device file changes before deletion',async()=>{
  verified();const client=new BrowserDevice();await client.connect();fake.request.mockImplementationOnce(async()=>({recordings:[copy],commands:[]})).mockRejectedValueOnce(Error('Server copy is missing'))
  await expect(client.deleteFile('meeting.hda',true)).rejects.toThrow('missing');expect(fake.devices.at(-1).deleteFile).not.toHaveBeenCalled()
  verified();fake.files[0].signature='changed';await expect(client.deleteFile('meeting.hda',true)).rejects.toThrow('changed');expect(fake.devices.at(-1).deleteFile).not.toHaveBeenCalled();await client.disconnect()
})
it('runs deferred library cleanup directly without downloading the deleted recording again',async()=>{
  fake.request.mockImplementation(async(path:string)=>path.includes('/manifest?')?{recordings:[],commands:[{id:'cleanup',...copy}]}:{ok:true});const client=new BrowserDevice();await client.connect();expect(fake.devices.at(-1).deleteFile).toHaveBeenCalledWith('meeting.hda');expect(fake.devices.at(-1).downloadFile).not.toHaveBeenCalled();expect(fake.upload).not.toHaveBeenCalled();expect(fake.request).toHaveBeenCalledWith('/api/v1/device/commands/cleanup/ack',{serial:'P1-original',checksum:copy.checksum});await client.disconnect()
})
it('auto-deletes only after upload completion and fresh server verification when enabled',async()=>{
  const client=new BrowserDevice();await client.connect();fake.invoke.mockResolvedValue({autoDownload:false,autoDeleteFromDevice:true});let saved=false;fake.upload.mockImplementationOnce(async()=>{expect(fake.devices.at(-1).deleteFile).not.toHaveBeenCalled();saved=true;verified();return 'saved'});await client.download(['meeting.hda'])
  expect(saved).toBe(true);expect(fake.request).toHaveBeenCalledWith('/api/v1/device/verify-copy',expect.anything());expect(fake.devices.at(-1).deleteFile).toHaveBeenCalledWith('meeting.hda');expect(fake.devices.at(-1).downloadFile).toHaveBeenCalledTimes(1);expect(await client.api.getFiles()).toEqual([]);await client.disconnect()
})
it('never auto-deletes after an upload failure and keeps the device copy after failed deletion verification',async()=>{
  const client=new BrowserDevice();await client.connect();fake.invoke.mockResolvedValue({autoDownload:false,autoDeleteFromDevice:true});fake.upload.mockRejectedValueOnce(Error('Upload not verified'));await expect(client.download(['meeting.hda'])).rejects.toThrow('not verified');expect(fake.devices.at(-1).deleteFile).not.toHaveBeenCalled()
  fake.upload.mockImplementationOnce(async()=>{verified();fake.request.mockImplementation(async(path:string)=>{if(path.includes('/manifest?'))return{recordings:[copy],commands:[]};throw Error('Server verification failed')});return 'saved'});await client.download(['meeting.hda']);expect(fake.devices.at(-1).deleteFile).not.toHaveBeenCalled();expect((await client.api.getDownloads()).queue[0].status).toBe('completed');expect((await client.api.getFiles())[0].localVerified).toBe(true);await client.disconnect()
})
it('reports storage failures as failures rather than deliberate cancellation',async()=>{
  const client=new BrowserDevice();await client.connect();storage.getFileHandle=async()=>({getFile:async()=>new NodeBlob([]),createWritable:async()=>({write:async()=>{throw Error('Storage is full')},close:async()=>undefined,abort:async()=>undefined})}) as any;await expect(client.download(['meeting.hda'])).rejects.toThrow('Storage is full');expect((await client.api.getDownloads()).queue[0].status).toBe('failed');await client.disconnect()
})
