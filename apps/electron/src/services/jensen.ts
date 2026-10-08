// Adapted from sgeraldes/hidock-next-2 @ 31d44da (MIT).
/** Jensen renderer binding. All hardware is owned by the main-process client. */
export type { DeviceModel, DeviceInfo, FileInfo, CardInfo, DeviceSettings, BatteryStatus } from '@hidock/jensen-protocol'
export { JensenIpcClient as JensenDevice } from './jensen-ipc-client'
