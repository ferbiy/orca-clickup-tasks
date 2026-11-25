// Registers the Tasks page source as worker commands (`taskSource.clickup.list|get|action`, declared
// in orca-plugin.json). The Overhedge Orca build turns them into a ClickUp tab on the Tasks page and
// validates every answer; stock Orca lists them in the command palette, where a run without the
// page's arguments does nothing (no ClickUp request) or says what the command is for.
import type { OrcaWorkerApi } from 'orca/worker'
import { messageOf, PluginError } from '../../shared/errors'
import { TASK_SOURCE_ID } from './items'
import type { ListParams, TaskSourceService } from './task-source-service'

const PALETTE_HINT = "This command feeds the ClickUp tab of Orca's Tasks page (Overhedge build); open that page instead."

function field(args: unknown, key: string): unknown {
  return typeof args === 'object' && args !== null && !Array.isArray(args) ? (args as Record<string, unknown>)[key] : undefined
}

function text(args: unknown, key: string): string | undefined {
  const value = field(args, key)
  return typeof value === 'string' ? value : undefined
}

/** The Tasks page always sends `query` and `filters`; anything else is a palette run. */
export function parseListParams(args: unknown): ListParams | null {
  const query = text(args, 'query')
  const raw = field(args, 'filters')
  if (query === undefined || typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const filters: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) if (typeof value === 'string') filters[key] = value
  const cursor = text(args, 'cursor')
  return { query: query.slice(0, 256), filters, ...(cursor ? { cursor } : {}) }
}

/** What the person reads in the Tasks page for a failure: the plugin's own message, with the wait for a 429. */
export function failureMessage(error: unknown): string {
  if (error instanceof PluginError) {
    if (error.code === 'rate_limited' && error.retryAfterMs !== undefined) {
      return `ClickUp asks to slow down; try again in ${Math.ceil(error.retryAfterMs / 1000)} s.`
    }
    if (error.code === 'auth_invalid') return 'ClickUp refused the saved sign-in. Sign in again in the ClickUp Tasks panel.'
    return error.message
  }
  return messageOf(error)
}

export function registerTaskSource(
  orca: Pick<OrcaWorkerApi, 'commands'>,
  deps: { source: TaskSourceService; onAuthInvalid: () => Promise<void>; log: (message: string) => void }
): void {
  const command = (operation: 'list' | 'get' | 'action', work: (args: unknown) => Promise<unknown>) => {
    orca.commands.register(`taskSource.${TASK_SOURCE_ID}.${operation}`, async (args) => {
      try {
        return await work(args)
      } catch (error) {
        if (!(error instanceof PluginError)) deps.log(`taskSource.${operation} failed: ${messageOf(error)}`)
        // Same rule as the panel's requests: a refused token was revoked, so forget it.
        if (error instanceof PluginError && error.code === 'auth_invalid') {
          await deps.onAuthInvalid().catch((e: unknown) => deps.log(`invalidate failed: ${messageOf(e)}`))
        }
        throw new Error(failureMessage(error))
      }
    })
  }

  command('list', async (args) => {
    const params = parseListParams(args)
    return params ? deps.source.list(params) : { items: [], notice: PALETTE_HINT }
  })
  command('get', async (args) => {
    const itemId = text(args, 'itemId')
    if (itemId === undefined) throw new PluginError('invalid_input', PALETTE_HINT)
    return deps.source.get(itemId)
  })
  command('action', async (args) => {
    const itemId = text(args, 'itemId')
    const actionId = text(args, 'actionId')
    if (itemId === undefined || actionId === undefined) throw new PluginError('invalid_input', PALETTE_HINT)
    const value = text(args, 'value')
    return deps.source.action({ itemId, actionId, ...(value !== undefined ? { value } : {}) })
  })
}
