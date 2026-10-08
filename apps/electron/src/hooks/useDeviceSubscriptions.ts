// Adapted from sgeraldes/hidock-next-2 @ 31d44da (MIT).
/** Device subscriptions. Downloads continue in the main process across navigation. */
import { useEffect } from 'react'
import { getHiDockDeviceService } from '../services/hidock-device'
import { useAppStore, reportError } from '../store/useAppStore'

export function shouldLatchAutoSync(recordingsLength: number, deviceRecordingCount: number): boolean { return recordingsLength > 0 || deviceRecordingCount <= 0 }
export function clearAllActivityBuffers(): void {
  getHiDockDeviceService().clearActivityLog()
  useAppStore.getState().clearActivity()
}
export async function clearActivity(): Promise<void> { await window.electronAPI.activity.clear(); clearAllActivityBuffers() }
export function useDeviceSubscriptions(): void {
  useEffect(() => {
    const service = getHiDockDeviceService()
    const removeLocal = service.onActivity(entry => useAppStore.getState().addActivity(entry))
    const removeMain = window.electronAPI.activity.onEntry(entry => service.acceptActivity(entry))
    const removeCleared = window.electronAPI.activity.onCleared(clearAllActivityBuffers)
    let mounted = true
    const generation = service.getActivityGeneration()
    void window.electronAPI.activity.list().then(entries => { if (mounted && generation === service.getActivityGeneration()) for (const entry of entries) service.acceptActivity(entry) }).catch(reportError)
    void window.electronAPI.settings.get().then(settings => { if (mounted) useAppStore.getState().setSettings(settings) }).catch(reportError)
    return () => { mounted = false; removeLocal(); removeMain(); removeCleared() }
  }, [])
}
