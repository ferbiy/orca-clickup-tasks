// The one error vocabulary of the plugin. Services throw PluginError. Orca turns any thrown code that
// is not a host error code into 'action_failed', so handlers never let a PluginError escape: they
// answer a Result envelope instead, and the panel's api.ts unwraps it back into a PluginError.
// Pure: safe in panel and worker.

export type ErrorCode =
  /** No token saved, or no Workspace selected yet. */
  | 'not_connected'
  /** ClickUp refused the token (ECODE OAUTH_*), whatever the HTTP status. */
  | 'auth_invalid'
  /** ClickUp 429; `retryAfterMs` tells when to try again. */
  | 'rate_limited'
  /** Network failure, timeout or ClickUp 5xx. */
  | 'clickup_unavailable'
  /** Task, List or project no longer exists or is not visible to this token. */
  | 'not_found'
  /** The request itself was malformed (bad id, empty token). */
  | 'invalid_input'
  /** The OS has no keyring, so the token cannot be stored safely. */
  | 'secrets_unavailable'
  /** An Orca host call failed (workspace create, agent launch, open). */
  | 'orca_failed'
  /** ClickUp refused a write for lack of permission (ACCESS_*, 403, non-OAUTH 401). */
  | 'forbidden'
  /** The task changed since the panel last saw it; the write was not sent. */
  | 'conflict'

export interface PluginErrorShape {
  code: ErrorCode
  message: string
  retryAfterMs?: number
}

export class PluginError extends Error {
  readonly code: ErrorCode
  readonly retryAfterMs?: number

  constructor(code: ErrorCode, message: string, retryAfterMs?: number) {
    super(message)
    this.name = 'PluginError'
    this.code = code
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs
  }
}

const CODES: readonly ErrorCode[] = [
  'not_connected',
  'auth_invalid',
  'rate_limited',
  'clickup_unavailable',
  'not_found',
  'invalid_input',
  'secrets_unavailable',
  'orca_failed',
  'forbidden',
  'conflict'
]

/** Reads the code off anything a request rejected with; unknown codes become 'orca_failed'. */
export function errorCodeOf(error: unknown): ErrorCode {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && (CODES as readonly string[]).includes(code)
    ? (code as ErrorCode)
    : 'orca_failed'
}

/** What every plugin.request answers. Thrown errors would lose their code crossing to the panel. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: PluginErrorShape }

export function toErrorShape(error: unknown): PluginErrorShape {
  if (error instanceof PluginError) {
    return error.retryAfterMs === undefined
      ? { code: error.code, message: error.message }
      : { code: error.code, message: error.message, retryAfterMs: error.retryAfterMs }
  }
  return { code: errorCodeOf(error), message: messageOf(error) }
}

/** A readable message for anything thrown: Error, a host error object `{ message }`, or a value. */
export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message
  }
  return typeof error === 'string' ? error : 'Unknown error'
}

export function fromErrorShape(shape: PluginErrorShape): PluginError {
  return new PluginError(shape.code, shape.message, shape.retryAfterMs)
}
