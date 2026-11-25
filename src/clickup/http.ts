// T3. The only file that calls ClickUp's API with the person's token (fetch is injected). Worker-only.
import { PluginError } from '../shared/errors'
import type { Clock } from '../worker/ports'
import { parseErrorBody } from './mapper'

export type FetchLike = (url: string, init?: {
  method?: string
  headers?: Record<string, string>
  body?: string
  signal?: AbortSignal
}) => Promise<{ status: number; headers: { get(name: string): string | null }; text(): Promise<string> }>

export interface ClickUpHttpOptions {
  /** The Authorization header value: a personal token as is, an OAuth token as `Bearer <token>`. */
  token: string
  /** Shared request budget for every tracker of this worker; none in unit tests. */
  gate?: RateGate
  fetch: FetchLike
  /** Default https://api.clickup.com/api/v2 */
  baseUrl?: string
  /** Default 20 000 ms per request. */
  timeoutMs?: number
  clock?: Clock
}

export interface ClickUpHttp {
  /**
   * Sends `Authorization: <token>` (no "Bearer"), JSON body when given, query params encoded
   * (array values as repeated `key[]=v`). Parses JSON. Errors → PluginError:
   *   body.ECODE starting "OAUTH_" (any status) or a GET 401 → 'auth_invalid'
   *   429 → 'rate_limited', retryAfterMs from X-RateLimit-Reset (epoch seconds) minus now, min 1000
   *   non-GET only: ECODE ACCESS_*, 403, or 401 without OAUTH_* → 'forbidden' (a refused write
   *     must not log the person out)
   *   404, or ECODE ITEM_015, or a GET ACCESS_* → 'not_found'
   *   5xx, network error, timeout → 'clickup_unavailable'
   *   other 4xx → 'invalid_input' with ClickUp's `err` text
   */
  request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    options?: { query?: Record<string, string | number | boolean | readonly (string | number)[] | undefined>; body?: unknown }
  ): Promise<T>
}

/**
 * A client-side budget under ClickUp's per-token limit (100 requests a minute on Free, Unlimited
 * and Business), so the plugin slows itself down instead of hitting 429, and stops for everyone
 * after a 429 until ClickUp's reset time.
 */
export interface RateGate {
  /** Waits for a slot; throws 'rate_limited' when the wait would be longer than the gate allows. */
  acquire(): Promise<void>
  /** A 429 arrived: no request until `epochMs`. */
  blockUntil(epochMs: number): void
}

export function createRateGate(options: {
  perMinute: number
  clock: Clock
  sleep: (ms: number) => Promise<void>
  /** Longest wait before giving up with 'rate_limited'. */
  maxWaitMs: number
}): RateGate {
  const sent: number[] = []
  let blockedUntil = 0
  return {
    async acquire() {
      for (;;) {
        const now = options.clock()
        while (sent.length > 0 && now - sent[0]! >= 60_000) sent.shift()
        const wait = Math.max(blockedUntil - now, sent.length >= options.perMinute ? sent[0]! + 60_000 - now : 0)
        if (wait <= 0) {
          sent.push(now)
          return
        }
        if (wait > options.maxWaitMs) {
          throw new PluginError('rate_limited', 'ClickUp request budget used up for this minute', Math.max(MIN_RETRY_MS, Math.ceil(wait)))
        }
        await options.sleep(wait)
      }
    },
    blockUntil(epochMs) {
      blockedUntil = Math.max(blockedUntil, epochMs)
    }
  }
}

const DEFAULT_BASE_URL = 'https://api.clickup.com/api/v2'
const DEFAULT_TIMEOUT_MS = 20_000
const MIN_RETRY_MS = 1000

function buildQuery(query: NonNullable<Parameters<ClickUpHttp['request']>[2]>['query']): string {
  if (!query) return ''
  const parts: string[] = []
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue
    if (typeof value === 'object') {
      for (const item of value) parts.push(`${key}[]=${encodeURIComponent(String(item))}`)
    } else {
      parts.push(`${key}=${encodeURIComponent(String(value))}`)
    }
  }
  return parts.length > 0 ? `?${parts.join('&')}` : ''
}

export function createClickUpHttp(options: ClickUpHttpOptions): ClickUpHttp {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const clock: Clock = options.clock ?? Date.now

  async function request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    opts?: Parameters<ClickUpHttp['request']>[2]
  ): Promise<T> {
    const url = `${baseUrl}${path}${buildQuery(opts?.query)}`
    const headers: Record<string, string> = { Authorization: options.token }
    const controller = new AbortController()
    const init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal } = {
      method,
      headers,
      signal: controller.signal
    }
    if (opts?.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      init.body = JSON.stringify(opts.body)
    }

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)

    await options.gate?.acquire()
    let status: number
    let text: string
    let resetHeader: string | null
    try {
      const response = await options.fetch(url, init)
      status = response.status
      resetHeader = response.headers.get('X-RateLimit-Reset')
      text = await response.text()
    } catch (error) {
      const reason = timedOut
        ? `ClickUp did not answer within ${timeoutMs} ms`
        : `Could not reach ClickUp: ${error instanceof Error ? error.message : String(error)}`
      throw new PluginError('clickup_unavailable', reason)
    } finally {
      clearTimeout(timer)
    }

    if (status >= 200 && status < 300) {
      if (text.trim() === '') return undefined as T
      try {
        return JSON.parse(text) as T
      } catch {
        throw new PluginError('clickup_unavailable', 'ClickUp returned a response that is not JSON')
      }
    }

    const body = parseErrorBody(text)
    const ecode = body.ecode ?? ''
    const detail = body.err ?? `HTTP ${status}`
    if (ecode.startsWith('OAUTH_') || (status === 401 && method === 'GET')) {
      throw new PluginError('auth_invalid', detail)
    }
    if (status === 429) {
      const resetSeconds = Number(resetHeader)
      const wait =
        resetHeader !== null && resetHeader.trim() !== '' && Number.isFinite(resetSeconds)
          ? resetSeconds * 1000 - clock()
          : 0
      const retryAfterMs = Math.max(MIN_RETRY_MS, Math.ceil(wait))
      options.gate?.blockUntil(clock() + retryAfterMs)
      throw new PluginError('rate_limited', 'ClickUp rate limit reached', retryAfterMs)
    }
    if (method !== 'GET' && (status === 401 || status === 403 || ecode.startsWith('ACCESS_'))) {
      throw new PluginError('forbidden', detail)
    }
    if (status === 404 || ecode === 'ITEM_015' || ecode.startsWith('ACCESS_')) {
      throw new PluginError('not_found', detail)
    }
    if (status >= 500) {
      throw new PluginError('clickup_unavailable', `ClickUp error ${status}: ${detail}`)
    }
    throw new PluginError('invalid_input', detail)
  }

  return { request }
}
