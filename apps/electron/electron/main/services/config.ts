import { app } from 'electron'
import { join } from 'node:path'
import type { AppSettings } from '../../../src/shared/contracts'

export interface AppConfig { device: { autoConnect: boolean; autoDownload: boolean }; storage: { dataPath: string; recordingsPath: string; transcriptsPath?: string; capturesPath?: string } }
let settingsReader: (() => AppSettings) | undefined
export function configureSettingsReader(reader: () => AppSettings): void { settingsReader = reader }
export function getDataPath(): string { return app.getPath('userData') }
export function getConfig(): AppConfig {
  const settings = settingsReader?.()
  return { device: { autoConnect: settings?.autoConnect ?? true, autoDownload: settings?.autoDownload ?? true }, storage: { dataPath: getDataPath(), recordingsPath: settings?.recordingsPath || join(getDataPath(), 'recordings') } }
}
