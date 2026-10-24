/** Recovery and transfers need durable local staging, which browsers restrict to secure contexts. */
export function browserStorageAvailability(): string | null {
  if (typeof window !== 'undefined' && !window.isSecureContext) return 'USB sync and browser capture recovery need HTTPS. Open the secure server address.'
  if (typeof navigator === 'undefined' || typeof navigator.storage?.getDirectory !== 'function') return 'This browser does not provide the temporary file storage needed for USB sync and capture recovery. Use desktop Chrome or Edge.'
  return null
}
