import { desktopBridge } from '../services/desktop-recorder'
import { USB_VENDOR_IDS } from '@hidock/jensen-protocol'
import { appClient } from '../services/app-client'
import { subscribe } from '../services/http'
import type { AppSettings } from '../shared/contracts'
// Adapted from sgeraldes/hidock-next-2 @ 31d44da (MIT).
/** Device subscriptions. Downloads continue in the main process across navigation. */
import { useEffect } from 'react'
import { getHiDockDeviceService } from '../services/hidock-device'
import { useAppStore, reportError } from '../store/useAppStore'
import { browserDevice, usbAvailability } from '../services/browser-device'

export function shouldLatchAutoSync(recordingsLength: number, deviceRecordingCount: number): boolean { return recordingsLength > 0 || deviceRecordingCount <= 0 }
export function clearAllActivityBuffers(): void {
  getHiDockDeviceService().clearActivityLog()
  useAppStore.getState().clearActivity()
}
export async function clearActivity(): Promise<void> { await appClient.activity.clear(); clearAllActivityBuffers() }
export function useDeviceSubscriptions(): void {
  useEffect(() => {
    const service = getHiDockDeviceService()
    const removeSettings = subscribe<AppSettings>('settings:changed', settings => { browserDevice.applySettings(settings); useAppStore.getState().setSettings(settings) })
    const removeLocal = service.onActivity(entry => useAppStore.getState().addActivity(entry))
    const removeMain = appClient.activity.onEntry(entry => service.acceptActivity(entry))
    const removeCleared = appClient.activity.onCleared(clearAllActivityBuffers)
    let mounted = true
    const generation = service.getActivityGeneration()
    void appClient.activity.list().then(entries => { if (mounted && generation === service.getActivityGeneration()) for (const entry of entries) service.acceptActivity(entry) }).catch(reportError)
    void appClient.settings.get().then(settings => { if (mounted) { useAppStore.getState().setSettings(settings); if (settings.autoConnect && !usbAvailability()) void browserDevice.connect(true).catch(reportError) } }).catch(reportError)
    const interval = setInterval(() => { if (!browserDevice.busy) void browserDevice.sync().catch(reportError) }, 60000)
    const detached = (event: USBConnectionEvent) => { if (!USB_VENDOR_IDS.includes(event.device.vendorId)) return; void browserDevice.disconnect().catch(reportError) }
    const removeNative = desktopBridge()?.onDetached(() => { void browserDevice.disconnect().catch(reportError) })
    navigator.usb?.addEventListener('disconnect', detached)
    return () => { mounted = false; clearInterval(interval); removeNative?.(); navigator.usb?.removeEventListener('disconnect', detached); removeSettings(); removeLocal(); removeMain(); removeCleared() }
  }, [])
}
