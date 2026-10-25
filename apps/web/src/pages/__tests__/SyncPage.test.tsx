// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SyncPage } from '../SyncPage'
import { setAppClient } from '../../services/app-client'
import { useAppStore } from '../../store/useAppStore'
import type { AppClient, DownloadState } from '../../shared/contracts'
import type { UseDevicePipelineResult } from '../../hooks/useDevicePipeline'
vi.mock('../../components/BrowserSyncTools',()=>({BrowserSyncTools:()=>null}))
vi.mock('../../services/browser-device',()=>({usbAvailability:()=>null,browserDevice:{}}))
let changed:(value:DownloadState)=>void, device:UseDevicePipelineResult
const update=vi.fn(),remove=vi.fn(),download=vi.fn()
beforeEach(()=>{
  update.mockReset().mockImplementation(async patch=>({...useAppStore.getState().settings,...patch}));remove.mockReset().mockResolvedValue({result:'success'});download.mockReset().mockResolvedValue(undefined)
  useAppStore.setState({settings:{name:'Owner',autoConnect:false,autoDownload:false,autoDeleteFromDevice:false,appearance:'dark',recordingsPath:'/data'},error:null})
  device={state:{phase:'downloading',device:{model:'hidock-p1',serialNumber:'P1',firmwareVersion:'1.3',storage:null,settings:null,recordingCount:2},scanProgress:null,error:null,downloadProgress:{filename:'new.hda',current:1,total:2,bytesDownloaded:25,totalBytes:100,eta:null}},files:[{name:'new.hda',length:100,time:new Date('2026-10-23'),duration:20,signature:'new',version:1,createDate:'20261023',createTime:'100000'},{name:'saved.hda',length:100,time:new Date('2026-10-22'),duration:20,signature:'saved',version:1,createDate:'20261022',createTime:'100000',localVerified:true}],connect:vi.fn(),disconnect:vi.fn(),sync:vi.fn(),cancel:vi.fn(),deleteFile:remove}
  setAppClient({settings:{update},devicePipeline:{getDownloads:async()=>({queue:[{filename:'new.hda',status:'downloading',progress:25,fileSize:100}],isProcessing:true,isPaused:false}),onDownloads:callback=>{changed=callback;return()=>undefined},download}} as unknown as AppClient)
})
afterEach(cleanup)
it('shows the transfer bar above the table and updates the row percentage',async()=>{
  render(<SyncPage device={device}/>);await screen.findByText('25%');const bar=screen.getByRole('region',{name:'Current recording transfer'}),table=screen.getByRole('table');expect(bar.compareDocumentPosition(table)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(screen.getByRole('progressbar',{name:'Recording transfer progress'})).toHaveAttribute('value','25')
  await act(async()=>changed({queue:[{filename:'new.hda',status:'downloading',progress:75,fileSize:100}],isProcessing:true,isPaused:false}));expect(screen.getByText('75%')).toBeVisible();expect(screen.queryByRole('switch',{name:'Auto-record'})).not.toBeInTheDocument()
})
it('saves both download and verified-copy deletion preferences without starting a download',async()=>{
  render(<SyncPage device={device}/>);fireEvent.click(screen.getByRole('switch',{name:'Delete from device after verified copy'}));await waitFor(()=>expect(update).toHaveBeenCalledWith({autoDeleteFromDevice:true}));fireEvent.click(screen.getByRole('switch',{name:'Auto-download new recordings'}));await waitFor(()=>expect(update).toHaveBeenCalledWith({autoDownload:true}));fireEvent.click(screen.getByRole('switch',{name:'Auto-download new recordings'}));await waitFor(()=>expect(update).toHaveBeenCalledWith({autoDownload:false}));expect(download).not.toHaveBeenCalled()
})
it('confirms direct deletion while idle without a download or progress bar',async()=>{
  device.state={...device.state,phase:'idle',downloadProgress:null};render(<SyncPage device={device}/>);fireEvent.click(screen.getByRole('button',{name:'Delete saved.hda from device'}));expect(screen.getByRole('alertdialog')).toHaveTextContent('verified server copy');expect(screen.getByRole('alertdialog')).toHaveTextContent('No audio is downloaded');fireEvent.click(screen.getByRole('button',{name:'Delete from device',exact:true}));await waitFor(()=>expect(remove).toHaveBeenCalledWith('saved.hda',true));expect(download).not.toHaveBeenCalled();expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
})
