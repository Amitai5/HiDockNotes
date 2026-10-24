let serverOrigin: string | null = null
/** Only the configured HTTPS origin can be offered as a device-sync destination. */
export function setServerOrigin(value: unknown): void {
  serverOrigin = null
  if (typeof value !== 'string') return
  try { const url = new URL(value); if (url.protocol === 'https:' && url.origin === value && !url.username && !url.password) serverOrigin = url.origin } catch { /* An older server may not advertise its public address. */ }
}
export function secureSyncUrl(): string | null { return serverOrigin ? `${serverOrigin}/#/sync` : null }
