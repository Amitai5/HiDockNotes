import { createHash, createPublicKey, timingSafeEqual, verify, type JsonWebKey } from 'node:crypto'
import type { ModelChoice } from '../../../src/shared/ai'
import { ProcessingError } from './errors'

export const CHATGPT_ISSUER = 'https://auth.openai.com'
export const CHATGPT_RESOURCE = 'https://api.openai.com/v1'
export const CHATGPT_AUTHORIZE = CHATGPT_ISSUER + '/api/accounts/authorize'
export const CHATGPT_TOKEN_ENDPOINT = CHATGPT_ISSUER + '/api/accounts/oauth/token'
export const CHATGPT_DISCOVERY = CHATGPT_ISSUER + '/.well-known/openid-configuration'
export const CHATGPT_USAGE = 'https://chatgpt.com/settings/usage'
export const CHATGPT_SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
export interface ChatGPTIdentity { issuer: string; subject: string; email: string | null; name: string | null }
export interface ChatGPTTokens { accessToken: string; refreshToken: string | null; idToken: string; expiresAt: number; earliestRefreshAt: number | null; scopes: string[] }
export interface AuthorizationAttempt { clientId: string; hostId: string; appName: string; state: string; nonce: string; verifier: string; redirectUri: string; identity?: ChatGPTIdentity; requestConsent?: boolean }
export class ChatGPTSessionExpired extends ProcessingError {
  constructor() { super('Your ChatGPT session expired or was revoked. Continue with ChatGPT in Settings to reconnect.') }
}
export class ChatGPTPlanBlocked extends ProcessingError {}

export function sameSecret(left: string, right: string): boolean {
  const a = Buffer.from(left), b = Buffer.from(right)
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b)
}
export function authorizationUrl(attempt: AuthorizationAttempt): string {
  const url = new URL(CHATGPT_AUTHORIZE)
  const fields = { client_id: attempt.clientId, ext_agent_host_id: attempt.hostId, response_type: 'code', redirect_uri: attempt.redirectUri, scope: CHATGPT_SCOPES, resource: CHATGPT_RESOURCE, state: attempt.state, nonce: attempt.nonce, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(attempt.verifier).digest('base64url') }
  for (const [name, value] of Object.entries(fields)) url.searchParams.set(name, value)
  if (attempt.clientId === 'dynamic_agent_client') url.searchParams.set('agent_name_hint', attempt.appName)
  // Returning sign-in deliberately uses the account selector rather than
  // placing a retained ID token in an authorization URL or diagnostics.
  if (attempt.identity?.email) url.searchParams.set('login_hint', attempt.identity.email)
  if (attempt.requestConsent) url.searchParams.set('prompt', 'consent')
  return url.toString()
}
export function callbackResult(url: URL, attempt: AuthorizationAttempt): { code: string; clientId: string } {
  for (const field of ['state', 'code', 'client_id', 'error']) if (url.searchParams.getAll(field).length > 1) throw new ProcessingError('The sign-in callback was invalid. Start a new sign-in.')
  if (!sameSecret(url.searchParams.get('state') ?? '', attempt.state)) throw new ProcessingError('The sign-in callback did not match this attempt. Start a new sign-in.')
  if (url.searchParams.has('error')) throw new ProcessingError('ChatGPT sign-in was not authorized. You can try again in Settings.')
  const code = url.searchParams.get('code'), suppliedClient = url.searchParams.get('client_id')
  const clientId = suppliedClient ?? attempt.clientId
  if (!code || code.length > 16000 || !/^[a-zA-Z0-9._:-]{1,200}$/.test(clientId) || clientId === 'dynamic_agent_client' || (attempt.clientId !== 'dynamic_agent_client' && suppliedClient && suppliedClient !== attempt.clientId)) throw new ProcessingError('ChatGPT registration was incomplete or changed accounts. Start a new sign-in.')
  return { code, clientId }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProcessingError('ChatGPT returned an invalid sign-in response. Try again.')
  return value as Record<string, unknown>
}
export function parseTokens(value: unknown, now: number, previous?: ChatGPTTokens): ChatGPTTokens {
  const item = record(value)
  if (item.token_type !== 'Bearer' || typeof item.access_token !== 'string' || !item.access_token || item.access_token.length > 32000 || typeof item.expires_in !== 'number' || !Number.isFinite(item.expires_in) || item.expires_in <= 0 || item.expires_in > 86400) throw new ProcessingError('ChatGPT returned incomplete credentials. Sign in again.')
  const idToken = typeof item.id_token === 'string' ? item.id_token : previous?.idToken
  const refreshToken = typeof item.refresh_token === 'string' && item.refresh_token ? item.refresh_token : previous?.refreshToken ?? null
  const scopes = typeof item.scope === 'string' ? item.scope.trim().split(/\s+/).filter(Boolean) : previous?.scopes
  if (!idToken || idToken.length > 32000 || !scopes || scopes.length > 40 || (refreshToken && refreshToken.length > 32000)) throw new ProcessingError('ChatGPT returned incomplete credentials. Sign in again.')
  const earliest = typeof item.earliest_refresh_at === 'number' && Number.isFinite(item.earliest_refresh_at) ? item.earliest_refresh_at * 1000 : null
  return { accessToken: item.access_token, refreshToken, idToken, scopes, expiresAt: now + item.expires_in * 1000, earliestRefreshAt: earliest }
}
export function planAllowed(tokens: ChatGPTTokens): boolean { return tokens.scopes.includes('chatgpt.tokens.use.direct') && tokens.scopes.includes('resource.invoke') }
export function validateIdentity(token: string, jwks: unknown, clientId: string, nonce: string | null, now: number): ChatGPTIdentity {
  const parts = token.split('.')
  if (parts.length !== 3 || parts.some(part => !/^[a-zA-Z0-9_-]+$/.test(part)) || token.length > 32000) throw new ProcessingError('ChatGPT identity could not be verified. Sign in again.')
  let header: Record<string, unknown>, claims: Record<string, unknown>
  try { header = record(JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))); claims = record(JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))) }
  catch { throw new ProcessingError('ChatGPT identity could not be verified. Sign in again.') }
  const keys = record(jwks).keys
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.crit !== undefined || !Array.isArray(keys)) throw new ProcessingError('ChatGPT identity could not be verified. Sign in again.')
  const matches = keys.filter(value => value && typeof value === 'object' && value.kid === header.kid && value.kty === 'RSA' && (!value.use || value.use === 'sig') && (!value.alg || value.alg === 'RS256'))
  if (matches.length !== 1) throw new ProcessingError('ChatGPT signing keys changed. Start a new sign-in.')
  let valid = false
  try { valid = verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), createPublicKey({ key: matches[0] as JsonWebKey, format: 'jwk' }), Buffer.from(parts[2], 'base64url')) } catch { /* Invalid public key/signature is a rejected identity. */ }
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  const seconds = now / 1000
  if (!valid || claims.iss !== CHATGPT_ISSUER || !audience.includes(clientId) || (audience.length > 1 && claims.azp !== clientId) || typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 500 || typeof claims.exp !== 'number' || claims.exp <= seconds || (typeof claims.nbf === 'number' && claims.nbf > seconds + 30) || (typeof claims.iat === 'number' && claims.iat > seconds + 30) || (nonce !== null && (typeof claims.nonce !== 'string' || !sameSecret(claims.nonce, nonce)))) throw new ProcessingError('ChatGPT identity could not be verified. Sign in again.')
  return { issuer: CHATGPT_ISSUER, subject: claims.sub, email: typeof claims.email === 'string' ? claims.email.slice(0, 320) : null, name: typeof claims.name === 'string' ? claims.name.slice(0, 160) : null }
}
export function parseChatGPTModels(value: unknown): ModelChoice[] {
  const models = record(value).models
  if (!Array.isArray(models)) throw new ProcessingError('ChatGPT model discovery is unavailable. Refresh models in Settings.', true)
  const seen = new Set<string>()
  return models.flatMap(item => {
    if (!item || typeof item !== 'object' || item.visibility !== 'list' || typeof item.slug !== 'string' || !/^[a-zA-Z0-9._:-]{1,120}$/.test(item.slug) || seen.has(item.slug)) return []
    seen.add(item.slug)
    return [{ id: item.slug, name: typeof item.display_name === 'string' ? item.display_name.slice(0, 160) : item.slug, transcription: false, chat: true }]
  })
}
export function chatgptError(code: unknown, status = 0): ProcessingError {
  if (code === 'subscription_sharing_usage_limit_exceeded' || status === 429) return new ChatGPTPlanBlocked('ChatGPT plan usage limit reached. Open Manage usage in Settings to review your allowance, then retry.')
  if (code === 'subscription_sharing_usage_unavailable' || code === 'subscription_sharing_user_unavailable') return new ProcessingError('ChatGPT plan usage is temporarily unavailable. Your connection is retained; retry later.', true)
  if (['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused'].includes(String(code)) || status === 401) return new ChatGPTSessionExpired()
  if (code === 'subscription_sharing_user_not_eligible') return new ChatGPTPlanBlocked('This ChatGPT account or workspace is not eligible for plan usage. Open Manage usage or select an eligible account.')
  if (['subscription_sharing_invalid_user', 'chatpass_v2_scope_not_authorized', 'chatpass_v2_invalid_authorization_context', 'subscription_sharing_route_not_supported'].includes(String(code))) return new ChatGPTPlanBlocked('ChatGPT did not accept this plan permission context. Review your connection and Manage usage before retrying.')
  if (status === 403) return new ChatGPTPlanBlocked('ChatGPT plan permission or account policy prevented this request. Review Manage usage and your account settings.')
  if (code === 'subscription_sharing_unsupported_capability') return new ChatGPTPlanBlocked('ChatGPT plan usage rejected an unsupported model or request feature. Choose another text model.')
  if (status === 404) return new ChatGPTPlanBlocked('This ChatGPT model is unavailable for your account. Refresh models in Settings and choose another.')
  return new ProcessingError('The ChatGPT request could not complete. Check your connection and try again.', status === 0 || status >= 500)
}
