// Sign in with ClickUp (OAuth authorization code). ClickUp has no PKCE, so the exchange needs the
// app's client secret: the person creates their own OAuth app in ClickUp and saves its client id
// and secret once; both live in Orca's encrypted secrets (OS keychain), never in storage, logs,
// the panel or this repository. Flow:
//   begin()   → random `state`, a listener on the loopback redirect URL (when it is one), and the
//               authorize URL the panel opens in the browser (it carries no secret);
//   callback  → state checked (constant time, one use, 10 min), code exchanged, token verified and
//               saved by AuthService as an 'oauth' credential;
//   paste     → the same check for the address the browser ended on, when the listener cannot be
//               reached (Orca's web client on a server, a port in use, an https redirect).
import { PluginError } from '../../shared/errors'
import type { AuthState, OAuthAppState, OAuthPending } from '../../shared/model'
import type { FetchLike } from '../../clickup/http'
import { authorizeUrl, DEFAULT_REDIRECT_URI, exchangeCode, loopbackTarget, validRedirectUri } from '../../clickup/oauth'
import type { LoopbackAnswer, LoopbackHandle, LoopbackListen } from '../loopback'
import type { Clock, KeyValueStore, PanelPoster, SecretStore } from '../ports'
import type { AuthService } from './auth-service'

const CLIENT_KEY = 'oauth.client'
const REDIRECT_KEY = 'oauth.redirectUri'
const DEFAULT_TIMEOUT_MS = 10 * 60_000
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,128}$/

export interface OAuthServiceDeps {
  secrets: SecretStore
  kv: KeyValueStore
  auth: AuthService
  fetch: FetchLike
  listen: LoopbackListen
  clock: Clock
  /** 32 random bytes as hex (crypto.getRandomValues in the worker). */
  randomState: () => string
  /** Runs `work` after `ms`; answers a cancel. */
  schedule: (work: () => void, ms: number) => () => void
  post: PanelPoster
  log: (message: string) => void
  timeoutMs?: number
}

interface Pending extends OAuthPending {
  state: string
  clientId: string
  redirectUri: string
  server: LoopbackHandle | null
  cancelTimer: () => void
}

/** Compares without an early exit, so timing does not reveal how much of `state` matched. */
function sameSecret(a: string, b: string): boolean {
  let diff = a.length ^ b.length
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return diff === 0
}

export class OAuthService {
  private pending: Pending | null = null
  /** A spent sign-in's listener, still open for a moment so its answer page is sent. */
  private closing: LoopbackHandle | null = null

  constructor(private readonly deps: OAuthServiceDeps) {
    deps.auth.oauthState = () => this.appState()
  }

  async appState(): Promise<OAuthAppState> {
    const client = await this.readClient()
    const p = this.pending
    return {
      clientId: client?.clientId ?? null,
      redirectUri: await this.redirectUri(),
      pending: p ? { authorizeUrl: p.authorizeUrl, expiresAt: p.expiresAt, listening: p.listening } : null
    }
  }

  /**
   * Saves the OAuth app. `clientSecret` may be left out to keep the saved one (same client id).
   * The redirect URL must be the one registered in ClickUp.
   */
  async saveApp(input: { clientId: string; clientSecret?: string; redirectUri?: string }): Promise<AuthState> {
    await this.deps.auth.requireKeyring()
    const clientId = input.clientId.trim()
    if (!CLIENT_ID_RE.test(clientId)) throw new PluginError('invalid_input', 'That does not look like a ClickUp client id.')
    const saved = await this.readClient()
    const secret = input.clientSecret?.trim() || (saved?.clientId === clientId ? saved.clientSecret : '')
    if (!secret) throw new PluginError('invalid_input', 'Paste the client secret of your ClickUp app.')
    if (secret.length > 256 || /\s/.test(secret)) throw new PluginError('invalid_input', 'That does not look like a client secret.')
    const redirect = (input.redirectUri ?? '').trim() || DEFAULT_REDIRECT_URI
    if (!validRedirectUri(redirect)) {
      throw new PluginError('invalid_input', 'The redirect URL must be https, or http on 127.0.0.1 / localhost with a port.')
    }
    await this.cancel()
    await this.deps.secrets.set(CLIENT_KEY, JSON.stringify({ clientId, clientSecret: secret }))
    await this.deps.kv.set(REDIRECT_KEY, redirect)
    return this.deps.auth.announce()
  }

  /** Forgets the app's client id and secret (the sign-in, if any, stays until Sign out). */
  async forgetApp(): Promise<AuthState> {
    await this.cancel()
    await this.deps.secrets.delete(CLIENT_KEY)
    await this.deps.kv.delete(REDIRECT_KEY)
    return this.deps.auth.announce()
  }

  /** Starts a sign-in: fresh state, the loopback listener when possible, the authorize URL. */
  async begin(): Promise<AuthState> {
    await this.deps.auth.requireKeyring()
    const client = await this.readClient()
    if (!client) throw new PluginError('invalid_input', 'Save your ClickUp app (client id and secret) first.')
    await this.cancel()
    const redirectUri = await this.redirectUri()
    const state = this.deps.randomState()
    const target = loopbackTarget(redirectUri)
    let server: LoopbackHandle | null = null
    if (target) {
      try {
        server = await this.deps.listen({ ...target, onCallback: ({ params }) => this.onCallback(params) })
      } catch (error) {
        // Port in use, or no loopback here: the paste fallback still works.
        this.deps.log(`oauth: could not listen on 127.0.0.1:${target.port}: ${String(error)}`)
      }
    }
    const timeoutMs = this.deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const pending: Pending = {
      state,
      clientId: client.clientId,
      redirectUri,
      authorizeUrl: authorizeUrl(client.clientId, redirectUri, state),
      expiresAt: this.deps.clock() + timeoutMs,
      listening: server !== null,
      server,
      cancelTimer: () => undefined
    }
    pending.cancelTimer = this.deps.schedule(() => {
      if (this.pending === pending) void this.cancel().then(() => this.deps.auth.announce())
    }, timeoutMs)
    this.pending = pending
    return this.deps.auth.announce()
  }

  /** The person pasted the address the browser ended on (or just its query string). */
  async completeFromUrl(pasted: string): Promise<AuthState> {
    const text = pasted.trim()
    if (!text || text.length > 4096) throw new PluginError('invalid_input', 'Paste the whole address from the browser.')
    let query: URLSearchParams
    try {
      query = text.startsWith('?') || !text.includes('?') ? new URLSearchParams(text.replace(/^\?/, '')) : new URL(text).searchParams
    } catch {
      throw new PluginError('invalid_input', 'That is not a web address. Paste the whole address from the browser.')
    }
    const params: Record<string, string> = {}
    query.forEach((value, key) => {
      params[key] = value
    })
    return this.complete(params)
  }

  private async release(server: LoopbackHandle): Promise<void> {
    if (this.closing === server) this.closing = null
    await server.close().catch(() => undefined)
  }

  async cancel(): Promise<void> {
    // A new sign-in needs the port: close a spent listener now instead of in a moment.
    if (this.closing) await this.release(this.closing)
    const p = this.pending
    this.pending = null
    if (!p) return
    p.cancelTimer()
    await p.server?.close().catch(() => undefined)
  }

  private async onCallback(params: Record<string, string>): Promise<LoopbackAnswer> {
    try {
      await this.complete(params)
      return { ok: true, message: 'Orca is now signed in to ClickUp.' }
    } catch (error) {
      const message = error instanceof PluginError ? error.message : 'The sign-in failed.'
      this.deps.post('oauth.failed', { message })
      return { ok: false, message }
    }
  }

  /** Checks state, then spends the pending sign-in (one use) before exchanging the code. */
  private async complete(params: Record<string, string>): Promise<AuthState> {
    const p = this.pending
    if (!p) throw new PluginError('invalid_input', 'No sign-in is waiting. Press "Sign in with ClickUp" again.')
    if (this.deps.clock() > p.expiresAt) {
      await this.cancel()
      throw new PluginError('invalid_input', 'The sign-in took too long. Start it again.')
    }
    if (typeof params.state !== 'string' || !sameSecret(params.state, p.state)) {
      // Not ours (another tab, an old link, or a forged request): keep waiting for the real one.
      throw new PluginError('invalid_input', 'That sign-in answer does not belong to this sign-in. Start it again from Orca.')
    }
    // Spend it now (one use). The listener closes a moment later, after this answer's page is sent.
    this.pending = null
    p.cancelTimer()
    if (p.server) {
      const server = p.server
      this.closing = server
      this.deps.schedule(() => void this.release(server), 2_000)
    }
    if (params.error) throw new PluginError('invalid_input', 'ClickUp did not grant access. Start the sign-in again to retry.')
    const code = params.code
    if (!code || code.length > 2048) throw new PluginError('invalid_input', 'ClickUp sent no authorization code.')
    const client = await this.readClient()
    if (!client || client.clientId !== p.clientId) throw new PluginError('invalid_input', 'The ClickUp app changed during sign-in. Start again.')
    const token = await exchangeCode(this.deps.fetch, { clientId: client.clientId, clientSecret: client.clientSecret, code })
    return this.deps.auth.connectWith(token, 'oauth')
  }

  private async redirectUri(): Promise<string> {
    const value = await this.deps.kv.get(REDIRECT_KEY)
    return typeof value === 'string' && validRedirectUri(value) ? value : DEFAULT_REDIRECT_URI
  }

  private async readClient(): Promise<{ clientId: string; clientSecret: string } | null> {
    const raw = await this.deps.secrets.get(CLIENT_KEY)
    if (!raw) return null
    try {
      const v = JSON.parse(raw) as { clientId?: unknown; clientSecret?: unknown }
      return typeof v.clientId === 'string' && typeof v.clientSecret === 'string' ? { clientId: v.clientId, clientSecret: v.clientSecret } : null
    } catch {
      return null
    }
  }
}
