let csrf = ''
export function setCsrf(value: string): void { csrf = value }
export const clientEvents = new EventTarget()
let connection: EventSource | null = null
const channels = ['notes:changed','settings:changed','library:changed','ai:changed','semantic:state','calendar:changed','conversations:changed','backup:state','restore:state','activity-log:entry','activity-log:cleared','browser:open','reconnected']
export function connectEvents(): () => void {
  connection?.close(); const source = new EventSource('/api/v1/events'); connection = source
  for (const channel of channels) source.addEventListener(channel, event => clientEvents.dispatchEvent(new CustomEvent(channel, { detail: JSON.parse((event as MessageEvent).data) })))
  source.addEventListener('signed-out', () => clientEvents.dispatchEvent(new Event('signed-out')))
  return () => { source.close(); if (connection === source) connection = null }
}
export function subscribe<T>(channel: string, callback: (value: T) => void): () => void { const listener = (event: Event) => callback((event as CustomEvent<T>).detail); clientEvents.addEventListener(channel, listener); const refresh = () => { if (channel === 'library:changed' || channel === 'calendar:changed') callback(undefined as T) }; clientEvents.addEventListener('reconnected', refresh); return () => { clientEvents.removeEventListener(channel, listener); clientEvents.removeEventListener('reconnected', refresh) } }
export async function response(path: string, init: RequestInit = {}): Promise<Response> {
  const result = await fetch(path, { ...init, credentials: 'same-origin', headers: { 'X-CSRF-Token': csrf, ...init.headers } })
  if (!result.ok) { let message = 'The server could not complete this request.'; try { message = (await result.json()).error ?? message } catch { /* Non-JSON proxy errors retain a safe message. */ }; if (result.status === 401) clientEvents.dispatchEvent(new Event('signed-out')); throw new Error(message) }
  return result
}
export async function request<T>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> { return (await response(path, { method, ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })).json() }
export async function invoke<T>(operation: string, ...args: unknown[]): Promise<T> { return (await request<{ result: T }>('/api/v1/rpc/' + encodeURIComponent(operation), { args })).result }
export async function download(result: Response, fallback: string): Promise<void> { const blob = await result.blob(), url = URL.createObjectURL(blob), link = document.createElement('a'); const encoded = /filename\*=UTF-8''([^;]+)/.exec(result.headers.get('Content-Disposition') ?? ''); link.download = encoded ? decodeURIComponent(encoded[1]) : fallback; link.href = url; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000) }
