import { getDownloadService } from '../services/download-service'
import { handle } from './trusted-ipc'

export function registerDownloadServiceHandlers(register: (channel: string, fn: (...args: unknown[]) => unknown) => void = handle): void {
  register('download-service:pause', () => getDownloadService().pause())
  register('download-service:resume', () => getDownloadService().resume())
}
