// The ClickUp tab of Orca's Tasks page (Overhedge build): list, detail and actions over the same
// services, caches and request budget as the sidebar panel. Only the chosen Lists are ever queried.
// "Mine, not closed" views are served from the panel's My tasks cache; other views ask ClickUp one
// page at a time, and a page is reused for PAGE_REUSE_MS so typing a search or the page's own
// two-minute refresh costs no extra requests.
import { PluginError } from '../../shared/errors'
import type { StatusOption, TaskSummary } from '../../shared/model'
import { LIST_IDS_PER_REQUEST } from '../../tracker/tracker'
import type { Clock } from '../ports'
import type { AuthService } from '../services/auth-service'
import type { ScopeService } from '../services/scope-service'
import type { StartService } from '../services/start-service'
import type { TaskService } from '../services/task-service'
import type { LinkStore } from '../stores/link-store'
import type { PrefsStore } from '../stores/prefs-store'
import {
  detailActions,
  detailMarkdown,
  parseProjectValue,
  toDetailItem,
  toItem,
  taskRef,
  type SourceDetail,
  type SourceFilter,
  type SourceItem
} from './items'

/** Items per answer from the cache. */
const PAGE_SIZE = 100
/** A ClickUp page (or the My tasks cache) younger than this is reused. */
export const PAGE_REUSE_MS = 60_000
/** With a search, more ClickUp pages are read in one answer until this many items match. */
const SEARCH_MIN_ITEMS = 25
/** ClickUp pages read for one answer at most. */
const PAGES_PER_ANSWER = 5

export interface ListParams {
  query: string
  filters: Record<string, string>
  cursor?: string
}

export interface ListAnswer {
  items: SourceItem[]
  nextCursor?: string
  filters?: SourceFilter[]
  notice?: string
}

export interface TaskSourceDeps {
  auth: Pick<AuthService, 'session'>
  tasks: Pick<TaskService, 'list' | 'get' | 'statuses' | 'cachedStatuses' | 'update' | 'queryTasks'>
  scope: Pick<ScopeService, 'get' | 'isEmpty' | 'lists'>
  start: Pick<StartService, 'projects' | 'run'>
  prefs: Pick<PrefsStore, 'settings' | 'projectForList'>
  links: Pick<LinkStore, 'findByTask'>
  clock: Clock
  agentLabel: (id: string) => string
}

type View = { list: string; assignee: 'me' | 'anyone'; status: string; closed: 'hide' | 'show' }

export class TaskSourceService {
  private pages = new Map<string, { at: number; tasks: TaskSummary[]; lastPage: boolean }>()

  constructor(private readonly deps: TaskSourceDeps) {}

  async list(params: ListParams): Promise<ListAnswer> {
    let userId: string
    try {
      userId = (await this.deps.auth.session()).userId
    } catch (error) {
      if (error instanceof PluginError && error.code === 'not_connected') {
        return { items: [], notice: 'Sign in to ClickUp in the ClickUp Tasks panel (right sidebar) first.' }
      }
      throw error
    }
    if (this.deps.scope.isEmpty(await this.deps.scope.get())) {
      return { items: [], notice: 'Choose the Lists Orca may see: ClickUp Tasks panel › Settings › Lists.' }
    }
    const lists = await this.deps.scope.lists()
    const view = readView(params.filters, lists)
    const statuses = await this.statusOptions(view.list, lists)
    const chosen = view.status === 'any' ? null : statuses.find((s) => s.name.toLowerCase() === view.status.toLowerCase()) ?? null
    const fromCache = view.assignee === 'me' && view.closed === 'hide' && (chosen === null || chosen.type !== 'closed')
    const query = params.query.trim().toLowerCase()
    const answer = fromCache
      ? await this.fromCache(view, chosen, query, params.cursor)
      : await this.fromClickUp(view, chosen, query, params.cursor, lists, userId)
    const seen = new Map(statuses.map((s) => [s.name.toLowerCase(), s]))
    for (const s of answer.seen) if (!seen.has(s.name.toLowerCase())) seen.set(s.name.toLowerCase(), { ...s, order: 999 })
    return {
      items: answer.tasks.map(toItem),
      ...(answer.nextCursor ? { nextCursor: answer.nextCursor } : {}),
      filters: buildFilters(lists, [...seen.values()]),
      ...(answer.notice ? { notice: answer.notice } : {})
    }
  }

  async get(itemId: string): Promise<SourceDetail> {
    const task = await this.deps.tasks.get(requireItemId(itemId), { reuse: true })
    const [statuses, projects, settings, remembered, links] = await Promise.all([
      this.deps.tasks.statuses(task.list.id),
      this.deps.start.projects(),
      this.deps.prefs.settings(),
      this.deps.prefs.projectForList(task.list.id),
      this.deps.links.findByTask(task.id)
    ])
    return {
      item: toDetailItem(task),
      bodyMarkdown: detailMarkdown(task, links),
      actions: detailActions({ task, statuses, projects, rememberedProjectId: remembered, agentLabel: this.deps.agentLabel(settings.defaultAgent) })
    }
  }

  async action(params: { itemId: string; actionId: string; value?: string }): Promise<{ message?: string; detail?: SourceDetail }> {
    const itemId = requireItemId(params.itemId)
    if (params.actionId === 'set-status') {
      const task = await this.deps.tasks.get(itemId, { reuse: true })
      const wanted = (params.value ?? '').toLowerCase()
      const status = (await this.deps.tasks.statuses(task.list.id)).find((s) => s.name.toLowerCase() === wanted)
      if (!status) throw new PluginError('invalid_input', `“${params.value ?? ''}” is not a status of this List.`)
      if (status.name.toLowerCase() === task.status.name.toLowerCase()) {
        return { message: `${taskRef(task)} is already “${status.name}”.`, detail: await this.get(itemId) }
      }
      // update() re-reads the task (refreshing the sidebar's row) and tells the panel.
      await this.deps.tasks.update({ taskId: itemId, status: status.name })
      this.pages.clear()
      return { message: `${taskRef(task)}: “${status.name}”.`, detail: await this.get(itemId) }
    }
    if (params.actionId === 'start') {
      const project = parseProjectValue(params.value ?? '')
      if (!project) throw new PluginError('invalid_input', 'Pick a project to start in.')
      const settings = await this.deps.prefs.settings()
      const baseBranch = settings.defaultBaseBranch.trim()
      // The sidebar's Start flow with the person's defaults: worktree + agent + fenced prompt.
      const link = await this.deps.start.run({
        taskId: itemId,
        projectId: project.projectId,
        hostId: project.hostId,
        agent: settings.defaultAgent,
        ...(baseBranch ? { baseBranch } : {}),
        moveToInProgress: settings.moveToInProgress,
        taskContext: settings.taskContext
      })
      this.pages.clear()
      const note = link.onStart?.note ? ` ${link.onStart.note}` : ''
      return {
        message: `${this.deps.agentLabel(link.agent)} started on branch ${link.branch}.${note}`.slice(0, 512),
        detail: await this.get(itemId)
      }
    }
    throw new PluginError('invalid_input', `Unknown action “${params.actionId}”.`)
  }

  /** The chosen List's statuses (cached an hour); for all Lists, those already cached (no request). */
  private async statusOptions(list: string, lists: { id: string }[]): Promise<StatusOption[]> {
    if (list !== 'all') return this.deps.tasks.statuses(list)
    const byName = new Map<string, StatusOption>()
    for (const { id } of lists) {
      for (const s of (await this.deps.tasks.cachedStatuses(id)) ?? []) {
        if (!byName.has(s.name.toLowerCase())) byName.set(s.name.toLowerCase(), s)
      }
    }
    return [...byName.values()]
  }

  /** The panel's My tasks list, refetched when older than PAGE_REUSE_MS; paged by offset. */
  private async fromCache(view: View, chosen: StatusOption | null, query: string, cursor?: string) {
    const offset = parseCursor(cursor, 'c')[0] ?? 0
    let result = await this.deps.tasks.list(false)
    if (this.deps.clock() - result.fetchedAt > PAGE_REUSE_MS) result = await this.deps.tasks.list(true)
    const rows = result.tasks.filter(
      (t) =>
        (view.list === 'all' || t.list.id === view.list) &&
        (chosen === null || t.status.name.toLowerCase() === chosen.name.toLowerCase()) &&
        matches(t, query)
    )
    const next = offset + PAGE_SIZE
    return {
      tasks: rows.slice(offset, next),
      nextCursor: next < rows.length ? `c:${next}` : undefined,
      seen: result.tasks.map((t) => ({ name: t.status.name, type: t.status.type, order: 0 })),
      notice: undefined as string | undefined
    }
  }

  /** ClickUp's Workspace task query, one page per request, Lists in chunks of 40. */
  private async fromClickUp(
    view: View,
    chosen: StatusOption | null,
    query: string,
    cursor: string | undefined,
    lists: { id: string }[],
    userId: string
  ) {
    const ids = view.list === 'all' ? lists.map((l) => l.id) : [view.list]
    let [chunk = 0, page = 0] = parseCursor(cursor, 's')
    const tasks: TaskSummary[] = []
    let reads = 0
    while (chunk * LIST_IDS_PER_REQUEST < ids.length && reads < PAGES_PER_ANSWER) {
      const listIds = ids.slice(chunk * LIST_IDS_PER_REQUEST, (chunk + 1) * LIST_IDS_PER_REQUEST)
      const result = await this.page({
        listIds,
        ...(view.assignee === 'me' ? { assigneeId: userId } : {}),
        includeClosed: view.closed === 'show',
        ...(chosen ? { statuses: [chosen.name] } : {}),
        page
      })
      reads++
      tasks.push(...result.tasks.filter((t) => matches(t, query)))
      if (result.lastPage) {
        chunk++
        page = 0
      } else page++
      if (!query || tasks.length >= SEARCH_MIN_ITEMS) break
    }
    const more = chunk * LIST_IDS_PER_REQUEST < ids.length
    return {
      tasks,
      nextCursor: more ? `s:${chunk}:${page}` : undefined,
      seen: tasks.map((t) => ({ name: t.status.name, type: t.status.type, order: 0 })),
      notice: query && more && tasks.length < SEARCH_MIN_ITEMS ? 'ClickUp has no text search: Load more searches further pages.' : undefined
    }
  }

  private async page(params: Parameters<TaskService['queryTasks']>[0]) {
    const key = JSON.stringify(params)
    const now = this.deps.clock()
    const hit = this.pages.get(key)
    if (hit && now - hit.at <= PAGE_REUSE_MS) return hit
    for (const [k, v] of this.pages) if (now - v.at > PAGE_REUSE_MS) this.pages.delete(k)
    const result = await this.deps.tasks.queryTasks(params)
    const entry = { at: now, ...result }
    this.pages.set(key, entry)
    return entry
  }
}

function requireItemId(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw new PluginError('invalid_input', 'Not a ClickUp task id.')
  return value
}

function matches(task: TaskSummary, query: string): boolean {
  if (!query) return true
  return [task.name, task.customId ?? '', task.id, task.list.name].some((f) => f.toLowerCase().includes(query))
}

/** `c:<offset>` or `s:<chunk>:<page>`; none is the first page; a malformed one is refused. */
function parseCursor(cursor: string | undefined, kind: 'c' | 's'): number[] {
  if (cursor === undefined || cursor === '') return []
  const parts = cursor.split(':')
  const numbers = parts.slice(1).map(Number)
  if (parts[0] !== kind || numbers.length !== (kind === 'c' ? 1 : 2) || !numbers.every((n) => Number.isInteger(n) && n >= 0 && n <= 100_000)) {
    throw new PluginError('invalid_input', 'Bad page cursor; refresh the list.')
  }
  return numbers
}

function readView(filters: Record<string, string>, lists: { id: string }[]): View {
  const list = filters.list && lists.some((l) => l.id === filters.list) ? filters.list : 'all'
  return {
    list,
    assignee: filters.assignee === 'anyone' ? 'anyone' : 'me',
    status: filters.status || 'any',
    closed: filters.closed === 'show' ? 'show' : 'hide'
  }
}

const TYPE_ORDER: Record<StatusOption['type'], number> = { open: 0, unstarted: 1, custom: 2, done: 3, closed: 4 }

function buildFilters(lists: { id: string; name: string; folder: string | null }[], statuses: StatusOption[]): SourceFilter[] {
  const listOptions = lists.slice(0, 99).map((l) => ({
    value: l.id,
    label: (l.folder ? `${l.folder} › ${l.name}` : l.name).slice(0, 128) || l.id
  }))
  const statusOptions = [...statuses]
    .sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.order - b.order || a.name.localeCompare(b.name))
    .filter((s) => s.name !== '' && s.name.length <= 256)
    .slice(0, 99)
    .map((s) => ({ value: s.name, label: s.name.slice(0, 128) }))
  return [
    { id: 'list', label: 'List', defaultValue: 'all', options: [{ value: 'all', label: 'All chosen Lists' }, ...listOptions] },
    { id: 'assignee', label: 'Assignee', defaultValue: 'me', options: [{ value: 'me', label: 'Assigned to me' }, { value: 'anyone', label: 'Anyone' }] },
    { id: 'status', label: 'Status', defaultValue: 'any', options: [{ value: 'any', label: 'Any status' }, ...statusOptions] },
    { id: 'closed', label: 'Closed', defaultValue: 'hide', options: [{ value: 'hide', label: 'Hide closed' }, { value: 'show', label: 'Include closed' }] }
  ]
}
