import { resolve, join } from 'node:path'
import type { AppSettings } from '../../../src/shared/contracts'
export interface AppConfig { device: { autoConnect: boolean; autoDownload: boolean }; storage: { dataPath: string; recordingsPath: string; transcriptsPath?: string; capturesPath?: string } }
let dataPath: string | undefined
let settingsReader: (() => AppSettings) | undefined
export function configureDataPath(value: string): void { dataPath = resolve(value) }
export function configureSettingsReader(reader: () => AppSettings): void { settingsReader = reader }
export function getDataPath(): string { if (!dataPath) throw new Error('Configure the server data directory before starting services.'); return dataPath }
export function getConfig(): AppConfig { const settings = settingsReader?.(); return { device: { autoConnect: settings?.autoConnect ?? true, autoDownload: settings?.autoDownload ?? true }, storage: { dataPath: getDataPath(), recordingsPath: join(getDataPath(), 'recordings') } } }
