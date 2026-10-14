import { randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { ChatGPTState, ModelChoice } from '../../../src/shared/ai'
import { DEFAULT_CHATGPT_MODELS } from '../../../src/shared/ai'
import { CHATGPT_DISCOVERY, CHATGPT_ISSUER, CHATGPT_RESOURCE, CHATGPT_TOKEN_ENDPOINT, ChatGPTPlanBlocked, ChatGPTSessionExpired, authorizationUrl, callbackResult, chatgptError, parseChatGPTModels, parseTokens, planAllowed, sameSecret, validateIdentity, type AuthorizationAttempt, type ChatGPTIdentity } from './chatgpt-protocol'
import { ChatGPTStore } from './chatgpt-store'
import { ProcessingError, safeProcessingError } from './errors'

interface AuthDependencies { store: ChatGPTStore; appName: string; openBrowser(url: string): Promise<void>; changed(): void; signedIn(models: ModelChoice[]): void; sessionEnded?(profileId: string): void; request?: typeof fetch; now?: () => number }
interface PendingLogin { attempt: AuthorizationAttempt; profileId: string | null; server: Server; cancellation: AbortController; timeout: ReturnType<typeof setTimeout>; consumed: boolean }
interface Discovery { jwks_uri: string; revocation_endpoint: string }
const REVOCATION_WARNING = 'Signed out locally. Remote revocation could not be confirmed; disconnect HiDockNotes in ChatGPT Settings → Usage.'

export class ChatGPTAuth {
  private pending: PendingLogin | null = null
  private starting = false
  private error: string | null = null
  private readonly request: typeof fetch
  private readonly now: () => number
  private readonly refreshing = new Map<string, Promise<string>>()
  private readonly revoked = new Set<string>()
  private readonly signingOut = new Set<string>()
  private readonly sessionControllers = new Map<string, AbortController>()
  private readonly shutdown = new AbortController()
  private closed = false
  constructor(private readonly dependencies: AuthDependencies) { this.request = dependencies.request ?? fetch; this.now = dependencies.now ?? Date.now }
  state(): ChatGPTState {
    const profiles = this.dependencies.store.profiles(this.now()).map(profile => this.revoked.has(profile.id) ? { ...profile, connected: false, planEnabled: false } : profile), activeProfileId = this.dependencies.store.activeId()
    const active = profiles.find(profile => profile.id === activeProfileId)
    const blocked = activeProfileId ? this.dependencies.store.blockedReason(activeProfileId) : null
    const logoutWarning = activeProfileId ? this.dependencies.store.logoutWarning(activeProfileId) : null
    return { profiles, activeProfileId, connected: active?.connected ?? false, planEnabled: active?.planEnabled ?? false, signingIn: !!this.pending, error: blocked ?? logoutWarning ?? this.error, welcomePending: !!active?.planEnabled && this.dependencies.store.welcomePending(active.id), models: active?.models ?? DEFAULT_CHATGPT_MODELS, offline: active?.offline ?? true, usageBlocked: !!blocked }
  }
  async startSignIn(profileId: string | null = null): Promise<void> {
    if (this.closed) throw new ProcessingError('HiDockNotes is closing.')
    if (this.signingOut.size) throw new ProcessingError('Wait for ChatGPT sign-out to finish before signing in.')
    if (this.pending || this.starting) throw new ProcessingError('ChatGPT sign-in is already in progress. Complete it in your browser or cancel it.')
    const registration = profileId ? this.dependencies.store.registration(profileId) : null
    const hostId = this.dependencies.store.hostId()
    const server = createServer()
    this.starting = true
    try { await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve() }) }) }
    catch { this.starting = false; server.close(); throw new ProcessingError('The local sign-in callback could not start. Try again.') }
    if (this.closed || this.signingOut.size) { this.starting = false; server.close(); throw new ProcessingError('ChatGPT sign-in was cancelled while the connection was starting.') }
    const address = server.address()
    if (!address || typeof address === 'string') { this.starting = false; server.close(); throw new ProcessingError('The local sign-in callback could not start.') }
    const attempt: AuthorizationAttempt = { clientId: registration?.clientId ?? 'dynamic_agent_client', hostId, appName: this.dependencies.appName, state: randomBytes(32).toString('base64url'), nonce: randomBytes(32).toString('base64url'), verifier: randomBytes(48).toString('base64url'), redirectUri: `http://127.0.0.1:${address.port}/auth/callback`, identity: registration ?? undefined, requestConsent: !!registration && !this.dependencies.store.profiles(this.now()).find(profile => profile.id === registration.id)?.planEnabled }
    const cancellation = new AbortController()
    const timeout = setTimeout(() => { this.error = 'ChatGPT sign-in timed out. Start a new sign-in in Settings.'; this.cancelSignIn() }, 10 * 60 * 1000)
    const pending: PendingLogin = { attempt, profileId, server, cancellation, timeout, consumed: false }
    this.pending = pending
    this.starting = false
    this.error = null
    server.on('request', (request, response) => {
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.setHeader('Cache-Control', 'no-store')
      response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'")
      response.setHeader('Referrer-Policy', 'no-referrer')
      let url: URL
      try { url = new URL(request.url ?? '', attempt.redirectUri) } catch { response.writeHead(400); response.end('Invalid callback.'); return }
      if (request.method !== 'GET' || url.origin !== new URL(attempt.redirectUri).origin || url.pathname !== '/auth/callback' || request.headers.host !== new URL(attempt.redirectUri).host || (request.url?.length ?? 0) > 20000) { response.writeHead(404); response.end('Not found.'); return }
      if (pending.consumed) { response.writeHead(409); response.end('This sign-in has already been handled.'); return }
      let result: { code: string; clientId: string }
      try { result = callbackResult(url, attempt) }
      catch (error) {
        response.writeHead(400); response.end('Sign-in could not be completed. Return to HiDockNotes and try again.')
        // Unrelated requests cannot cancel the user's genuine pending login.
        if (sameSecret(url.searchParams.get('state') ?? '', attempt.state)) { this.error = safeProcessingError(error).message; this.finish(pending) }
        return
      }
      pending.consumed = true
      void this.completeSignIn(result, pending).then(() => {
        response.writeHead(200); response.end('<!doctype html><title>HiDockNotes</title><h1>ChatGPT is connected</h1><p>You can close this tab and return to HiDockNotes.</p>')
      }).catch(error => {
        if (this.pending === pending && !cancellation.signal.aborted) this.error = safeProcessingError(error).message
        response.writeHead(400); response.end('<!doctype html><title>HiDockNotes</title><h1>Sign-in could not complete</h1><p>Return to HiDockNotes to see the result and try again.</p>')
      }).finally(() => this.finish(pending))
    })
    server.on('error', () => { if (this.pending === pending) { this.error = 'The local ChatGPT sign-in listener stopped. Try signing in again.'; this.finish(pending) } })
    this.dependencies.changed()
    try { await this.dependencies.openBrowser(authorizationUrl(attempt)) }
    catch { this.error = 'The sign-in browser could not open. Start a new sign-in in Settings.'; this.finish(pending); throw new ProcessingError(this.error) }
  }
  cancelSignIn(): void { const pending = this.pending; if (pending) { pending.cancellation.abort(); this.finish(pending) } }
  select(id: string): void { this.cancelSignIn(); const previous = this.dependencies.store.activeId(); this.dependencies.store.select(id); if (previous && previous !== id) this.endSession(previous); this.error = null; this.dependencies.changed() }
  sessionSignal(id: string | null): AbortSignal {
    if (!id || this.closed || this.revoked.has(id) || this.dependencies.store.activeId() !== id) throw new ProcessingError('The selected ChatGPT connection is no longer active.')
    let controller = this.sessionControllers.get(id)
    if (!controller || controller.signal.aborted) { controller = new AbortController(); this.sessionControllers.set(id, controller) }
    return controller.signal
  }
  acknowledgeWelcome(): void { const id = this.dependencies.store.activeId(); if (id) this.dependencies.store.acknowledgeWelcome(id); this.dependencies.changed() }
  block(id: string, message: string): void { this.dependencies.store.block(id, message); this.dependencies.changed() }
  resume(): void { const id = this.dependencies.store.activeId(); if (id) this.dependencies.store.resume(id); this.error = null; this.dependencies.changed() }
  async accessToken(profileId: string | null = this.dependencies.store.activeId()): Promise<string> {
    if (this.closed) throw new ProcessingError('HiDockNotes is closing.')
    if (!profileId || this.revoked.has(profileId) || this.dependencies.store.activeId() !== profileId) throw new ProcessingError('The selected ChatGPT account changed or is signed out. Retry using the current account.')
    const blocked = this.dependencies.store.blockedReason(profileId)
    if (blocked) throw new ChatGPTPlanBlocked(blocked)
    const tokens = this.dependencies.store.tokens(profileId)
    if (!tokens) throw new ProcessingError('Continue with ChatGPT in Settings before using your plan.')
    if (!planAllowed(tokens)) throw new ProcessingError('ChatGPT plan permission is not enabled. Reconnect in Settings and authorize plan usage.')
    if (tokens.expiresAt - this.now() > 60000 || (tokens.expiresAt > this.now() && tokens.earliestRefreshAt !== null && tokens.earliestRefreshAt > this.now())) return tokens.accessToken
    const existing = this.refreshing.get(profileId)
    if (existing) return existing
    const refresh = this.refresh(profileId).finally(() => this.refreshing.delete(profileId))
    this.refreshing.set(profileId, refresh)
    return refresh
  }
  async refreshModels(): Promise<ModelChoice[]> {
    const id = this.dependencies.store.activeId()
    if (!id) throw new ProcessingError('Continue with ChatGPT before loading models.')
    const models = await this.models(await this.accessToken(id))
    if (this.closed || this.dependencies.store.activeId() !== id || this.revoked.has(id)) throw new ProcessingError('The selected ChatGPT account changed. Refresh models again.')
    this.dependencies.store.saveModels(id, models)
    this.error = null; this.dependencies.changed()
    return models
  }
  async signOut(id: string): Promise<string | null> {
    if (this.signingOut.has(id)) throw new ProcessingError('ChatGPT sign-out is already running.')
    const registration = this.dependencies.store.registration(id)
    this.cancelSignIn()
    this.signingOut.add(id)
    this.revoked.add(id)
    this.endSession(id)
    this.dependencies.changed()
    try {
      // Finish any rotation before revoking its latest replacement. The
      // account stops serving new requests as soon as sign-out begins.
      await this.refreshing.get(id)?.catch(() => undefined)
      if (this.closed) return REVOCATION_WARNING
      const tokens = this.dependencies.store.tokens(id)
      let warning: string | null = tokens?.refreshToken ? REVOCATION_WARNING : null
      this.dependencies.store.clearTokens(id)
      this.dependencies.store.saveLogoutWarning(id, warning)
      if (tokens?.refreshToken) {
        try {
          const endpoint = (await this.discovery()).revocation_endpoint
          await this.jsonRequest(endpoint, { method: 'POST', body: new URLSearchParams({ token: tokens.refreshToken, token_type_hint: 'refresh_token', client_id: registration.clientId }) }, true)
          if (!this.closed) { warning = null; this.dependencies.store.saveLogoutWarning(id, null) }
        } catch { /* Keep the persisted remote-revocation warning. */ }
      }
      this.error = warning
      return warning
    } finally { this.signingOut.delete(id); if (!this.closed) this.dependencies.changed() }
  }
  async remove(id: string): Promise<string | null> {
    if (this.closed) throw new ProcessingError('HiDockNotes is closing.')
    // Sign-out drains token rotation and cancels this connection's requests
    // before its encrypted credentials and registration are removed.
    const warning = await this.signOut(id)
    if (this.closed) throw new ProcessingError('HiDockNotes is closing. Retry removing the account after reopening.')
    this.dependencies.store.remove(id, this.now())
    this.sessionControllers.delete(id)
    this.revoked.delete(id)
    this.error = warning
    this.dependencies.changed()
    return warning
  }
  close(): void {
    this.closed = true
    for (const controller of this.sessionControllers.values()) controller.abort()
    for (const id of this.signingOut) { this.dependencies.store.clearTokens(id); this.dependencies.store.saveLogoutWarning(id, REVOCATION_WARNING) }
    this.shutdown.abort(); this.cancelSignIn()
  }
  private async completeSignIn(result: { code: string; clientId: string }, pending: PendingLogin): Promise<void> {
    const value = await this.jsonRequest(CHATGPT_TOKEN_ENDPOINT, { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', client_id: result.clientId, code: result.code, code_verifier: pending.attempt.verifier, redirect_uri: pending.attempt.redirectUri, resource: CHATGPT_RESOURCE }), signal: pending.cancellation.signal })
    const tokens = parseTokens(value, this.now())
    const identity = await this.identity(tokens.idToken, result.clientId, pending.attempt.nonce, pending.cancellation.signal)
    const previous = pending.attempt.identity
    if (previous && (previous.subject !== identity.subject || previous.issuer !== identity.issuer)) throw new ProcessingError('ChatGPT returned a different account. Add it as a separate connection.')
    let models: ModelChoice[] = []
    let blocked: string | null = null
    if (planAllowed(tokens)) {
      try { models = await this.models(tokens.accessToken, pending.cancellation.signal) }
      catch (error) { this.error = safeProcessingError(error).message; if (error instanceof ChatGPTPlanBlocked) blocked = error.message }
    }
    pending.cancellation.signal.throwIfAborted()
    if (this.pending !== pending) return
    const previousId = this.dependencies.store.activeId()
    const id = this.dependencies.store.save(result.clientId, identity, tokens, models)
    if (previousId && previousId !== id) this.endSession(previousId)
    this.revoked.delete(id)
    if (blocked) this.dependencies.store.block(id, blocked)
    if (planAllowed(tokens)) this.dependencies.signedIn(models.length ? models : DEFAULT_CHATGPT_MODELS)
  }
  private async refresh(id: string): Promise<string> {
    const current = this.dependencies.store.tokens(id), registration = this.dependencies.store.registration(id)
    if (!current?.refreshToken) throw new ProcessingError('Your ChatGPT session needs sign-in. Continue with ChatGPT in Settings.')
    try {
      const value = await this.jsonRequest(CHATGPT_TOKEN_ENDPOINT, { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', client_id: registration.clientId, refresh_token: current.refreshToken, resource: CHATGPT_RESOURCE }) })
      const tokens = parseTokens(value, this.now(), current)
      if (tokens.idToken !== current.idToken) {
        const identity = await this.identity(tokens.idToken, registration.clientId, null)
        if (identity.subject !== registration.subject || identity.issuer !== registration.issuer) throw new ProcessingError('ChatGPT refreshed a different account. Sign in again.')
      }
      if (this.closed) throw new ProcessingError('HiDockNotes is closing.')
      this.dependencies.store.replaceTokens(id, tokens)
      if (!planAllowed(tokens)) throw new ProcessingError('ChatGPT plan permission was removed. Reconnect in Settings and authorize plan usage.')
      if (this.revoked.has(id) || this.dependencies.store.activeId() !== id) throw new ProcessingError('The ChatGPT account changed. Retry using the current account.')
      return tokens.accessToken
    } catch (error) { if (!this.closed) { if (error instanceof ChatGPTSessionExpired) this.dependencies.store.clearTokens(id); this.error = safeProcessingError(error).message; this.dependencies.changed() }; throw error }
  }
  private async models(accessToken: string, signal?: AbortSignal): Promise<ModelChoice[]> {
    const models = parseChatGPTModels(await this.jsonRequest(CHATGPT_RESOURCE + '/models', { headers: { Authorization: 'Bearer ' + accessToken }, signal }))
    if (!models.length) throw new ProcessingError('No eligible ChatGPT models were returned. Review plan access in Manage usage.')
    return models
  }
  private async identity(token: string, clientId: string, nonce: string | null, signal?: AbortSignal): Promise<ChatGPTIdentity> {
    const discovery = await this.discovery(signal)
    const jwks = await this.jsonRequest(discovery.jwks_uri, { signal })
    return validateIdentity(token, jwks, clientId, nonce, this.now())
  }
  private async discovery(signal?: AbortSignal): Promise<Discovery> {
    const value = await this.jsonRequest(CHATGPT_DISCOVERY, { signal }) as Record<string, unknown>
    if (value.issuer !== CHATGPT_ISSUER || typeof value.jwks_uri !== 'string' || typeof value.revocation_endpoint !== 'string') throw new ProcessingError('OpenAI sign-in metadata could not be verified.')
    for (const endpoint of [value.jwks_uri, value.revocation_endpoint]) {
      const url = new URL(endpoint)
      if (url.origin !== CHATGPT_ISSUER || url.username || url.password || url.search || url.hash) throw new ProcessingError('OpenAI sign-in metadata could not be verified.')
    }
    return { jwks_uri: value.jwks_uri, revocation_endpoint: value.revocation_endpoint }
  }
  private async jsonRequest(url: string, options: RequestInit = {}, empty = false): Promise<unknown> {
    const signal = AbortSignal.any([this.shutdown.signal, ...(options.signal ? [options.signal] : []), AbortSignal.timeout(30000)])
    let response: Response
    try { response = await this.request(url, { ...options, signal, redirect: 'error' }) } catch { throw chatgptError(null) }
    if (!response.ok) {
      let code: unknown
      try { const value = await response.json() as { error?: string | { code?: string } }; code = typeof value.error === 'string' ? value.error : value.error?.code } catch { /* Status is sufficient; never expose response bodies. */ }
      throw chatgptError(code, response.status)
    }
    if (empty) return null
    try { return await response.json() } catch { throw new ProcessingError('OpenAI returned an unreadable sign-in response. Try again.') }
  }
  private finish(pending: PendingLogin): void {
    clearTimeout(pending.timeout)
    pending.server.close()
    if (this.pending === pending) { this.pending = null; this.dependencies.changed() }
  }
  private endSession(id: string): void { this.sessionControllers.get(id)?.abort(); this.dependencies.sessionEnded?.(id) }
}
