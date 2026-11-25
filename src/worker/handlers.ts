// Maps each protocol request to a service call and every outcome to a Result envelope.
// Validation of panel input happens here; services trust their typed arguments.
import type { JsonValue } from 'orca'
import type { OrcaWorkerApi } from 'orca/worker'
import { PluginError, toErrorShape, type Result } from '../shared/errors'
import type {
  ChecklistAction,
  CommentCursor,
  CommentInput,
  DateValue,
  Person,
  PluginSettings,
  Priority,
  SettingsState,
  StatusOverride,
  StatusTransition,
  TaskContextMode,
  TaskPatch
} from '../shared/model'
import type { Clipboard, PanelPoster } from './ports'
import type { AuthService } from './services/auth-service'
import type { OAuthService } from './services/oauth-service'
import type { ScopeService } from './services/scope-service'
import type { TransitionService } from './services/transition-service'
import type { EditService } from './services/edit-service'
import { AGENTS, type StartService } from './services/start-service'
import type { RunWatcher } from './services/run-watcher'
import type { TaskService } from './services/task-service'
import type { LinkStore } from './stores/link-store'
import type { PrefsStore } from './stores/prefs-store'

export interface Services {
  auth: AuthService
  oauth: OAuthService
  scope: ScopeService
  transitions: TransitionService
  tasks: TaskService
  edit: EditService
  start: StartService
  watcher: RunWatcher
  links: LinkStore
  prefs: PrefsStore
  clipboard: Clipboard
  /** Current time, for the 'tasks.changed' that follows cache.clear. */
  clock: () => number
  post: PanelPoster
  log: (message: string) => void
}

/**
 * Runs a handler body and folds any throw into `{ ok: false }`; unexpected errors are logged.
 * A refused token outside auth.connect means it was revoked: `onAuthInvalid` forgets it.
 */
export async function respond<T>(
  log: (m: string) => void,
  name: string,
  work: () => Promise<T>,
  onAuthInvalid?: () => Promise<void>
): Promise<Result<T>> {
  try {
    return { ok: true, value: await work() }
  } catch (error) {
    if (!(error instanceof PluginError)) log(`${name} failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
    const shape = toErrorShape(error)
    // A refused credential while connecting is the attempt failing, not the saved token revoked.
    if (shape.code === 'auth_invalid' && !name.startsWith('auth.') && onAuthInvalid) {
      await onAuthInvalid().catch((e: unknown) => log(`invalidate failed: ${String(e)}`))
    }
    return { ok: false, error: shape }
  }
}

function requirePage(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1000) {
    throw new PluginError('invalid_input', 'Bad page number.')
  }
  return value
}

/** A comment cursor from the panel, or undefined; a malformed one is refused, not ignored. */
function optionalCursor(value: unknown): CommentCursor | undefined {
  if (value === undefined || value === null) return undefined
  const v = value as { start?: unknown; startId?: unknown }
  if (typeof v.start !== 'number' || !Number.isFinite(v.start) || typeof v.startId !== 'string' || !v.startId) {
    throw new PluginError('invalid_input', 'Bad comment cursor.')
  }
  return { start: v.start, startId: v.startId }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new PluginError('invalid_input', `Missing ${field}.`)
  }
  return value
}

const MAX_BASE_BRANCH = 200

const TASK_CONTEXT_MODES: readonly string[] = ['link-and-snapshot', 'link-only', 'snapshot-only']

/** A task-context mode from the panel, or undefined; anything else is refused. */
function optionalTaskContext(value: unknown): TaskContextMode | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || !TASK_CONTEXT_MODES.includes(value)) {
    throw new PluginError('invalid_input', 'Bad task context mode.')
  }
  return value as TaskContextMode
}

/** Picks the known, correctly typed fields out of a settings.update input. Any bad field refuses the whole patch. */
export function parseSettingsPatch(input: unknown): Partial<PluginSettings> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new PluginError('invalid_input', 'Settings must be an object.')
  }
  const v = input as Record<string, unknown>
  const patch: Partial<PluginSettings> = {}
  if (v.defaultAgent !== undefined) {
    if (typeof v.defaultAgent !== 'string' || !AGENTS.some((a) => a.id === v.defaultAgent)) {
      throw new PluginError('invalid_input', 'Unknown default agent.')
    }
    patch.defaultAgent = v.defaultAgent
  }
  if (v.defaultBaseBranch !== undefined) {
    if (typeof v.defaultBaseBranch !== 'string') throw new PluginError('invalid_input', 'Base branch must be text.')
    const branch = v.defaultBaseBranch.trim()
    if (branch.length > MAX_BASE_BRANCH) {
      throw new PluginError('invalid_input', `Base branch is longer than ${MAX_BASE_BRANCH} characters.`)
    }
    patch.defaultBaseBranch = branch
  }
  for (const key of ['moveToInProgress', 'commentOnStart', 'moveOnDone', 'notifyOnDone', 'notifyOnNeedsInput'] as const) {
    if (v[key] === undefined) continue
    if (typeof v[key] !== 'boolean') throw new PluginError('invalid_input', `${key} must be true or false.`)
    patch[key] = v[key]
  }
  const taskContext = optionalTaskContext(v.taskContext)
  if (taskContext !== undefined) patch.taskContext = taskContext
  return patch
}

// ── Phase 8a: task editing input validation ───────────────────────────────

const MAX_NAME = 1024
const MAX_DESCRIPTION = 16_000
const MAX_MENTIONS = 20
const PRIORITIES: readonly string[] = ['urgent', 'high', 'normal', 'low']

function requireName(value: unknown, field: string): string {
  const name = requireString(value, field).trim()
  if (name.length > MAX_NAME) throw new PluginError('invalid_input', `${field} is longer than ${MAX_NAME} characters.`)
  return name
}

function optionalText(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new PluginError('invalid_input', `${field} must be text.`)
  if (value.length > max) throw new PluginError('invalid_input', `${field} is longer than ${max} characters.`)
  return value
}

function optionalDate(value: unknown, field: string): DateValue | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  const v = value as { at?: unknown; hasTime?: unknown }
  if (typeof v?.at !== 'number' || !Number.isFinite(v.at) || typeof v.hasTime !== 'boolean') {
    throw new PluginError('invalid_input', `${field} must be { at, hasTime } or null.`)
  }
  return { at: v.at, hasTime: v.hasTime }
}

function optionalEstimate(value: unknown): number | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new PluginError('invalid_input', 'The estimate must be whole milliseconds, 0 or more.')
  }
  return value
}

function idList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new PluginError('invalid_input', `${field} must be a list of ids.`)
  const ids: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || item.trim() === '') throw new PluginError('invalid_input', `${field} must be a list of ids.`)
    ids.push(item)
  }
  return ids
}

function memberDelta(value: unknown, field: string): { add: string[]; remove: string[] } | undefined {
  if (value === undefined) return undefined
  const v = value as { add?: unknown; remove?: unknown }
  if (typeof v !== 'object' || v === null) throw new PluginError('invalid_input', `${field} must be { add, remove }.`)
  return { add: idList(v.add, `${field}.add`), remove: idList(v.remove, `${field}.remove`) }
}

/** A TaskPatch from the panel, strictly validated; an unknown key refuses the whole patch. */
export function parseTaskPatch(value: unknown): TaskPatch {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PluginError('invalid_input', 'Patch must be an object.')
  }
  const v = value as Record<string, unknown>
  const patch: TaskPatch = {}
  for (const key of Object.keys(v)) {
    switch (key) {
      case 'name':
        patch.name = requireName(v.name, 'Name')
        break
      case 'markdownDescription':
        patch.markdownDescription = optionalText(v.markdownDescription, 'Description', MAX_DESCRIPTION)
        break
      case 'status':
        patch.status = requireString(v.status, 'Status')
        break
      case 'priority':
        if (v.priority !== null && (typeof v.priority !== 'string' || !PRIORITIES.includes(v.priority))) {
          throw new PluginError('invalid_input', 'Bad priority.')
        }
        patch.priority = v.priority as Priority | null
        break
      case 'dueDate':
        patch.dueDate = optionalDate(v.dueDate, 'Due date')
        break
      case 'startDate':
        patch.startDate = optionalDate(v.startDate, 'Start date')
        break
      case 'timeEstimateMs':
        patch.timeEstimateMs = optionalEstimate(v.timeEstimateMs)
        break
      case 'assignees':
        patch.assignees = memberDelta(v.assignees, 'Assignees')
        break
      case 'watchers':
        patch.watchers = memberDelta(v.watchers, 'Watchers')
        break
      case 'parentId':
        patch.parentId = requireString(v.parentId, 'Parent')
        break
      default:
        throw new PluginError('invalid_input', `Unknown patch key "${key}".`)
    }
  }
  return patch
}

/** A ChecklistAction from the panel, strictly validated. */
export function parseChecklistAction(value: unknown): ChecklistAction {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PluginError('invalid_input', 'Checklist action must be an object.')
  }
  const v = value as Record<string, unknown>
  switch (v.kind) {
    case 'create':
      return { kind: 'create', name: requireName(v.name, 'Checklist name') }
    case 'rename':
      return { kind: 'rename', checklistId: requireString(v.checklistId, 'checklistId'), name: requireName(v.name, 'Checklist name') }
    case 'delete':
      return { kind: 'delete', checklistId: requireString(v.checklistId, 'checklistId') }
    case 'addItem':
      return { kind: 'addItem', checklistId: requireString(v.checklistId, 'checklistId'), name: requireName(v.name, 'Item name') }
    case 'editItem': {
      const action: Extract<ChecklistAction, { kind: 'editItem' }> = {
        kind: 'editItem',
        checklistId: requireString(v.checklistId, 'checklistId'),
        itemId: requireString(v.itemId, 'itemId')
      }
      if (v.name !== undefined) action.name = requireName(v.name, 'Item name')
      if (v.resolved !== undefined) {
        if (typeof v.resolved !== 'boolean') throw new PluginError('invalid_input', 'resolved must be true or false.')
        action.resolved = v.resolved
      }
      if (action.name === undefined && action.resolved === undefined) {
        throw new PluginError('invalid_input', 'Nothing to change on that item.')
      }
      return action
    }
    case 'deleteItem':
      return { kind: 'deleteItem', checklistId: requireString(v.checklistId, 'checklistId'), itemId: requireString(v.itemId, 'itemId') }
    default:
      throw new PluginError('invalid_input', 'Unknown checklist action.')
  }
}

function parsePerson(value: unknown): Person {
  const v = value as { id?: unknown; name?: unknown; initials?: unknown }
  if (typeof v?.id !== 'string' || v.id.trim() === '' || typeof v.name !== 'string' || v.name === '') {
    throw new PluginError('invalid_input', 'Bad mention.')
  }
  return { id: v.id, name: v.name, initials: typeof v.initials === 'string' ? v.initials : '' }
}

/** A CommentInput from the panel: text 1–16 000 chars, at most 20 mentions. */
export function parseCommentInput(value: unknown): CommentInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PluginError('invalid_input', 'Comment must be an object.')
  }
  const v = value as Record<string, unknown>
  const text = typeof v.text === 'string' ? v.text : ''
  if (text.trim() === '') throw new PluginError('invalid_input', 'Missing comment text.')
  if (text.length > MAX_DESCRIPTION) throw new PluginError('invalid_input', `Comment is longer than ${MAX_DESCRIPTION} characters.`)
  if (!Array.isArray(v.mentions)) throw new PluginError('invalid_input', 'mentions must be a list.')
  if (v.mentions.length > MAX_MENTIONS) throw new PluginError('invalid_input', `At most ${MAX_MENTIONS} mentions per comment.`)
  return { text, mentions: v.mentions.map(parsePerson) }
}

/** 'start' | 'done' from the panel. */
function requireTransition(value: unknown): StatusTransition {
  if (value !== 'start' && value !== 'done') throw new PluginError('invalid_input', 'Bad transition.')
  return value
}

/** A status override from the panel: auto, none, or a status name (1–200 chars). */
export function parseOverride(value: unknown): StatusOverride {
  const v = value as { mode?: unknown; name?: unknown } | null
  if (v?.mode === 'auto') return { mode: 'auto' }
  if (v?.mode === 'none') return { mode: 'none' }
  if (v?.mode === 'status' && typeof v.name === 'string' && v.name.trim() !== '' && v.name.length <= 200) {
    return { mode: 'status', name: v.name }
  }
  throw new PluginError('invalid_input', 'Bad status choice.')
}

function optionalEpochMs(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new PluginError('invalid_input', `${field} must be epoch ms.`)
  return value
}

export function registerHandlers(orca: OrcaWorkerApi, s: Services): void {
  const r = <T>(name: string, work: () => Promise<T>) => respond(s.log, name, work, () => s.auth.invalidate())
  const handle = orca.panels.handle.bind(orca.panels)

  handle('auth.state', () => r('auth.state', () => s.auth.state()))
  handle('auth.connect', (input) => r('auth.connect', () => s.auth.connect(requireString(input?.token, 'token'))))
  handle('auth.disconnect', () => r('auth.disconnect', () => s.auth.disconnect()))
  handle('auth.selectTeam', (input) =>
    r('auth.selectTeam', () => s.auth.selectTeam(requireString(input?.teamId, 'teamId')))
  )
  handle('auth.oauthSaveApp', (input) =>
    r('auth.oauthSaveApp', () =>
      s.oauth.saveApp({
        clientId: requireString(input?.clientId, 'clientId'),
        ...(typeof input?.clientSecret === 'string' ? { clientSecret: input.clientSecret } : {}),
        ...(typeof input?.redirectUri === 'string' ? { redirectUri: input.redirectUri } : {})
      })
    )
  )
  handle('auth.oauthForgetApp', () => r('auth.oauthForgetApp', () => s.oauth.forgetApp()))
  handle('auth.oauthBegin', () => r('auth.oauthBegin', () => s.oauth.begin()))
  handle('auth.oauthPaste', (input) => r('auth.oauthPaste', () => s.oauth.completeFromUrl(requireString(input?.url, 'url'))))
  handle('auth.oauthCancel', () =>
    r('auth.oauthCancel', async () => {
      await s.oauth.cancel()
      return s.auth.announce()
    })
  )

  handle('scope.get', () => r('scope.get', () => s.scope.get()))
  handle('scope.set', (input) =>
    r('scope.set', async () => {
      const scope = await s.scope.set(input?.scope)
      s.post('tasks.changed', { fetchedAt: s.clock() })
      return scope
    })
  )
  handle('lists.mapping', (input) => r('lists.mapping', () => s.transitions.mapping(requireString(input?.listId, 'listId'))))
  handle('lists.setOverride', (input) =>
    r('lists.setOverride', () =>
      s.transitions.setOverride(requireString(input?.listId, 'listId'), requireTransition(input?.which), parseOverride(input?.override))
    )
  )

  handle('tasks.list', (input) => r('tasks.list', () => s.tasks.list(input?.refresh === true)))
  handle('tasks.get', (input) => r('tasks.get', () => s.tasks.get(requireString(input?.taskId, 'taskId'))))
  handle('tasks.comments', (input) =>
    r('tasks.comments', () => s.tasks.comments(requireString(input?.taskId, 'taskId'), optionalCursor(input?.before)))
  )
  handle('tasks.replies', (input) =>
    r('tasks.replies', () => s.tasks.replies(requireString(input?.commentId, 'commentId')))
  )
  handle('browse.spaces', (input) => r('browse.spaces', () => s.tasks.spaces(input?.refresh === true)))
  handle('browse.children', (input) =>
    r('browse.children', () => s.tasks.children(requireString(input?.spaceId, 'spaceId'), input?.refresh === true))
  )
  handle('browse.tasks', (input) =>
    r('browse.tasks', () =>
      s.tasks.listTasks(requireString(input?.listId, 'listId'), requirePage(input?.page), input?.includeClosed === true)
    )
  )
  handle('tasks.statuses', (input) =>
    r('tasks.statuses', () => s.tasks.statuses(requireString(input?.listId, 'listId')))
  )
  handle('tasks.update', (input) =>
    r('tasks.update', async () => {
      const taskId = requireString(input?.taskId, 'taskId')
      await s.tasks.update({
        taskId,
        ...(typeof input?.status === 'string' && input.status ? { status: input.status } : {}),
        ...(typeof input?.comment === 'string' ? { comment: input.comment } : {})
      })
      return { ok: true as const }
    })
  )

  handle('tasks.patch', (input) =>
    r('tasks.patch', () =>
      s.edit.patch(requireString(input?.taskId, 'taskId'), parseTaskPatch(input?.patch), {
        expectedUpdatedAt: optionalEpochMs(input?.expectedUpdatedAt, 'expectedUpdatedAt'),
        answerTaskId:
          typeof input?.answerTaskId === 'string' && input.answerTaskId !== '' ? input.answerTaskId : undefined
      })
    )
  )
  handle('tasks.tag', (input) =>
    r('tasks.tag', () => {
      const action = input?.action
      if (action !== 'add' && action !== 'remove') throw new PluginError('invalid_input', 'Bad tag action.')
      return s.edit.tag(requireString(input?.taskId, 'taskId'), requireName(input?.name, 'Tag name'), action)
    })
  )
  handle('tasks.checklist', (input) =>
    r('tasks.checklist', () =>
      s.edit.checklist(requireString(input?.taskId, 'taskId'), parseChecklistAction(input?.action))
    )
  )
  handle('tasks.createSubtask', (input) =>
    r('tasks.createSubtask', () =>
      s.edit.createSubtask(requireString(input?.taskId, 'taskId'), requireName(input?.name, 'Subtask name'))
    )
  )
  handle('workspace.members', (input) => r('workspace.members', () => s.edit.members(input?.refresh === true)))
  handle('tasks.spaceTags', (input) =>
    r('tasks.spaceTags', () => s.edit.spaceTags(requireString(input?.spaceId, 'spaceId'), input?.refresh === true))
  )

  handle('comments.create', (input) =>
    r('comments.create', () =>
      s.edit.addComment(requireString(input?.taskId, 'taskId'), parseCommentInput(input?.comment))
    )
  )
  handle('comments.reply', (input) =>
    r('comments.reply', () =>
      s.edit.replyComment(requireString(input?.commentId, 'commentId'), parseCommentInput(input?.comment))
    )
  )
  handle('comments.edit', (input) =>
    r('comments.edit', () => {
      const commentId = requireString(input?.commentId, 'commentId')
      const edit: { text?: string; assigneeId?: string | null; resolved?: boolean } = {}
      if (input?.text !== undefined) {
        const text = optionalText(input.text, 'Comment', MAX_DESCRIPTION)
        if (text === undefined || text.trim() === '') throw new PluginError('invalid_input', 'Comment text must not be empty.')
        edit.text = text
      }
      if (input?.assigneeId !== undefined) {
        if (input.assigneeId !== null && typeof input.assigneeId !== 'string') {
          throw new PluginError('invalid_input', 'assigneeId must be an id or null.')
        }
        edit.assigneeId = input.assigneeId
      }
      if (input?.resolved !== undefined) {
        if (typeof input.resolved !== 'boolean') throw new PluginError('invalid_input', 'resolved must be true or false.')
        edit.resolved = input.resolved
      }
      return s.edit.editComment(commentId, edit)
    })
  )
  handle('comments.delete', (input) =>
    r('comments.delete', () => s.edit.deleteComment(requireString(input?.commentId, 'commentId')))
  )

  handle('start.options', (input) =>
    r('start.options', () => s.start.options(requireString(input?.taskId, 'taskId')))
  )
  handle('start.run', (input) =>
    r('start.run', () =>
      s.start.run({
        taskId: requireString(input?.taskId, 'taskId'),
        projectId: requireString(input?.projectId, 'projectId'),
        ...(typeof input?.hostId === 'string' && input.hostId ? { hostId: input.hostId } : {}),
        agent: requireString(input?.agent, 'agent'),
        ...(typeof input?.baseBranch === 'string' ? { baseBranch: input.baseBranch } : {}),
        moveToInProgress: input?.moveToInProgress === true,
        ...(optionalTaskContext(input?.taskContext) ? { taskContext: optionalTaskContext(input?.taskContext) } : {})
      })
    )
  )

  const settingsState = async (): Promise<SettingsState> => ({
    settings: await s.prefs.settings(),
    agents: AGENTS.map((a) => ({ ...a }))
  })
  handle('settings.get', () => r('settings.get', settingsState))
  handle('settings.update', (input) =>
    r('settings.update', async () => {
      await s.prefs.updateSettings(parseSettingsPatch(input))
      return settingsState()
    })
  )
  handle('clipboard.copyTaskUrl', (input) =>
    r('clipboard.copyTaskUrl', async () => {
      const url = requireString(input?.url, 'url')
      // Only task links: the panel never sends anything else, and the worker copies nothing else.
      if (!/^https:\/\/app\.clickup\.com\/\S+$/.test(url) || url.length > 2048) {
        throw new PluginError('invalid_input', 'Not a ClickUp task link.')
      }
      if (!(await s.clipboard.write(url))) throw new PluginError('orca_failed', 'Could not reach the system clipboard.')
      return { ok: true as const }
    })
  )
  handle('cache.clear', () =>
    r('cache.clear', async () => {
      await s.tasks.clearCaches()
      s.post('tasks.changed', { fetchedAt: s.clock() })
      return { ok: true as const }
    })
  )

  handle('links.list', () => r('links.list', () => s.links.list()))

  handle('runs.check', (input) =>
    r('runs.check', async () => {
      if (input?.workspaceId === undefined) return s.watcher.checkAll()
      await s.watcher.check(requireString(input.workspaceId, 'workspaceId'))
      return s.links.list()
    })
  )

  handle('runs.prompt', (input) =>
    r('runs.prompt', async () => ({ text: await s.start.prompt(requireString(input?.workspaceId, 'workspaceId')) }))
  )
  handle('runs.forget', (input) =>
    r('runs.forget', async () => {
      await s.watcher.forget(requireString(input?.workspaceId, 'workspaceId'))
      return { ok: true as const }
    })
  )
}

export type { JsonValue }
