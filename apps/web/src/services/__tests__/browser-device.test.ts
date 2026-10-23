// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({ devices: [] as any[], invoke: vi.fn(), request: vi.fn(), calls: [] as string[] }))
vi.mock('../http', () => ({ clientEvents: new EventTarget(), invoke: fake.invoke, request: fake.request, response: vi.fn() }))
vi.mock('@hidock/jensen-protocol', () => ({ USB_VENDOR_IDS: [0x10d6,0x3887], supportsRealtimeFirmware: () => true, JensenDevice: class {
  connected = false
  constructor() { fake.devices.push(this) }
  tryConnect = vi.fn(async () => { this.connected=true;return true })
  isConnected = () => this.connected
  getDeviceInfo = async () => ({serialNumber:'P1-original',model:'hidock-p1',versionCode:'1.3',versionNumber:66312})
  getCardInfo = async () => null
  getSettings = async () => ({autoRecord:false})
  getBatteryStatus = async () => null
  getRecordingFile = async () => ({recording:null})
  listFiles = async () => [{name:'meeting.hda',length:100,time:new Date('2026-10-01'),duration:10,signature:'source',createDate:'20261001',createTime:'100000',version:1}]
  getActiveDownloadSettlement = vi.fn(async () => undefined)
  disconnect = vi.fn(async () => { this.connected=false })
  deleteFile = vi.fn(async () => ({result:'success'}))
} }))
import { BrowserDevice, usbAvailability } from '../browser-device'
let held = false, picker: ReturnType<typeof vi.fn>
beforeEach(() => { held=false;fake.calls.length=0;fake.request.mockResolvedValue({recordings:[],commands:[]});fake.invoke.mockResolvedValue({autoDownload:false});picker=vi.fn(()=>{fake.calls.push('picker');return Promise.resolve({vendorId:0x10d6})});vi.stubGlobal('isSecureContext',true);Object.defineProperty(window,'isSecureContext',{configurable:true,value:true});Object.defineProperty(navigator,'usb',{configurable:true,value:{requestDevice:picker,getDevices:async()=>[],addEventListener:vi.fn()}});Object.defineProperty(navigator,'locks',{configurable:true,value:{request:vi.fn(async (_name:string,_options:unknown,callback:(lock:unknown)=>Promise<void>)=>{fake.calls.push('lock');if(held)return callback(null);held=true;try{return await callback({})}finally{held=false}})}}) })
afterEach(()=>vi.unstubAllGlobals())
it('opens the permission picker directly from the user action before asynchronous ownership checks',async()=>{const client=new BrowserDevice(),connected=client.connect();expect(picker).toHaveBeenCalledOnce();expect(fake.calls[0]).toBe('picker');await connected;expect((await client.api.getState()).device?.serialNumber).toBe('P1-original');await client.disconnect()})
it('keeps a second tab from claiming a device already owned by the first tab',async()=>{const first=new BrowserDevice(),second=new BrowserDevice();await first.connect();await expect(second.connect()).rejects.toThrow('Another HiDockNotes');expect((await first.api.getState()).phase).toBe('idle');await first.disconnect();await expect(second.connect()).resolves.toBe(true);await second.disconnect()})
it('waits for transfer drain before closing the USB handle or releasing ownership',async()=>{const client=new BrowserDevice();await client.connect();const native=fake.devices.at(-1);let drain!:()=>void;native.getActiveDownloadSettlement.mockReturnValue(new Promise<void>(resolve=>{drain=resolve}));const disconnected=client.disconnect();await Promise.resolve();expect(native.disconnect).not.toHaveBeenCalled();expect(held).toBe(true);drain();await disconnected;expect(native.disconnect).toHaveBeenCalledOnce();expect(held).toBe(false)})
it('never deletes a recorder file without a matching verified server copy',async()=>{const client=new BrowserDevice();await client.connect();await expect(client.deleteFile('meeting.hda',true)).rejects.toThrow('matching verified server copy');expect(fake.devices.at(-1).deleteFile).not.toHaveBeenCalled();await client.disconnect()})
it('explains insecure origins before asking for device permission',async()=>{Object.defineProperty(window,'isSecureContext',{configurable:true,value:false});const client=new BrowserDevice();expect(usbAvailability()).toContain('HTTPS');await expect(client.connect()).rejects.toThrow('HTTPS');expect(picker).not.toHaveBeenCalled()})
