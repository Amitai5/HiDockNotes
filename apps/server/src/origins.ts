/** Explicit browser origins; aliases never enable cross-origin API access. */
export function allowedOrigins(primary: string, additional: readonly string[] = []): ReadonlySet<string> {
  const origins = new Set<string>()
  for (const value of [primary, ...additional]) {
    let url: URL
    try { url = new URL(value) } catch { throw new Error('Set APP_ORIGIN and APP_ALLOWED_ORIGINS to exact HTTP(S) origins, including any port.') }
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value || url.hostname.includes('*')) throw new Error('Set APP_ORIGIN and APP_ALLOWED_ORIGINS to exact HTTP(S) origins without paths, trailing slashes or wildcards.')
    origins.add(value)
  }
  return origins
}
