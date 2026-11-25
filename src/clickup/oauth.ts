// ClickUp OAuth (authorization-code flow): the authorize URL and the code → token exchange.
// Worker-only. ClickUp has no PKCE and no public clients: the exchange needs the app's client
// secret, which the person saves once into Orca's encrypted secrets (never into the repository).
import { PluginError } from '../shared/errors'
import type { FetchLike } from './http'
import { parseErrorBody } from './mapper'

export const AUTHORIZE_URL = 'https://app.clickup.com/api'
export const TOKEN_URL = 'https://api.clickup.com/api/v2/oauth/token'
export const DEFAULT_REDIRECT_URI = 'http://127.0.0.1:47386/callback'

/** The page the person opens in a browser. Carries no secret. */
export function authorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, state })
  return `${AUTHORIZE_URL}?${q.toString()}`
}

/**
 * A redirect URL the plugin can listen on itself: http on 127.0.0.1 or localhost with an explicit
 * port and a path. Anything else (an https page, another host) still works by pasting the address
 * the browser ends on back into the panel.
 */
export function loopbackTarget(redirectUri: string): { port: number; path: string } | null {
  let url: URL
  try {
    url = new URL(redirectUri)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' || (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost')) return null
  const port = Number(url.port)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return null
  return { port, path: url.pathname || '/' }
}

/** Checks a redirect URL the person typed: absolute http(s), no credentials, no fragment. */
export function validRedirectUri(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  if (url.username || url.password || url.hash) return false
  // Plain http only for this machine's loopback: a code must not cross a network unencrypted.
  return url.protocol === 'https:' || loopbackTarget(value) !== null
}

/** Exchanges an authorization code for an access token. Errors never include the secret or code. */
export async function exchangeCode(
  fetchImpl: FetchLike,
  input: { clientId: string; clientSecret: string; code: string },
  timeoutMs = 20_000
): Promise<string> {
  const params = { client_id: input.clientId, client_secret: input.clientSecret, code: input.code }
  // ClickUp documents query parameters; the same fields go in a JSON body for clients that read it.
  const url = `${TOKEN_URL}?${new URLSearchParams(params).toString()}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let status: number
  let text: string
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: controller.signal
    })
    status = response.status
    text = await response.text()
  } catch {
    throw new PluginError('clickup_unavailable', 'Could not reach ClickUp to finish signing in.')
  } finally {
    clearTimeout(timer)
  }
  if (status >= 200 && status < 300) {
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      throw new PluginError('clickup_unavailable', 'ClickUp answered the sign-in with something that is not JSON.')
    }
    const token = (json as { access_token?: unknown } | null)?.access_token
    if (typeof token === 'string' && token.trim() !== '') return token.trim()
    throw new PluginError('clickup_unavailable', 'ClickUp did not return an access token.')
  }
  const body = parseErrorBody(text)
  if (status === 429) throw new PluginError('rate_limited', 'ClickUp rate limit reached', 60_000)
  if (status >= 500) throw new PluginError('clickup_unavailable', `ClickUp error ${status} while signing in.`)
  // OAUTH_* here means the app credentials or the code were refused, not the saved token.
  const detail = body.err ?? `HTTP ${status}`
  throw new PluginError('invalid_input', `ClickUp refused the sign-in: ${detail}. Check the client id and secret, then sign in again.`)
}
