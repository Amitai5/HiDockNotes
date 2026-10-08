import { create } from 'zustand'
import type { ActivityEntry, AppSettings } from '../shared/contracts'

interface AppState {
  settings: AppSettings | null; search: string; activity: ActivityEntry[]; activityOpen: boolean; error: string | null
  setSettings(settings: AppSettings): void; setSearch(search: string): void; addActivity(entry: ActivityEntry): void; clearActivity(): void; setActivityOpen(open: boolean): void; setError(error: string | null): void
}
export const useAppStore = create<AppState>(set => ({
  settings: null, search: '', activity: [], activityOpen: false, error: null,
  setSettings: settings => set({ settings }), setSearch: search => set({ search }),
  addActivity: entry => set(state => state.activity.some(e => e.id === entry.id) ? state : { activity: [...state.activity, entry].slice(-200) }),
  clearActivity: () => set({ activity: [] }), setActivityOpen: activityOpen => set({ activityOpen }), setError: error => set({ error })
}))
export function reportError(error: unknown): void { useAppStore.getState().setError(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'The operation could not be completed.') }
export async function updateSettings(patch: Partial<Pick<AppSettings, 'name' | 'autoConnect' | 'autoDownload' | 'appearance'>>): Promise<boolean> { try { useAppStore.getState().setSettings(await window.electronAPI.settings.update(patch)); return true } catch (error) { reportError(error); return false } }
