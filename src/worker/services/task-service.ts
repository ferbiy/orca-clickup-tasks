// Reads and changes ClickUp tasks for the panel, behind a storage cache so the panel opens
// instantly and ClickUp's ~100 requests/minute budget is spent only on explicit refreshes.
// Only tasks of the chosen Lists (ScopeService) are listed, opened or handed to a start.
import { PluginError } from '../../shared/errors'
import type {
  CommentCursor,
  CommentPage,
  ListTasksPage,
  SpaceChildren,
  SpaceRef,
  StatusOption,
  TaskComment,
  TaskDetail,
  TaskListResult,
  TaskSummary,
  UpdateTaskRequest
} from '../../shared/model'
import type { Clock, PanelPoster } from '../ports'
import type { CacheStore } from '../stores/cache-store'
import type { AuthService } from './auth-service'
import type { ScopeService } from './scope-service'

export interface TaskServiceDeps {
  auth: AuthService
  /** Set right after construction in worker.ts (the scope reads Space contents through this service). */
  scope?: Pick<ScopeService, 'get' | 'isEmpty' | 'listIds' | 'assertList'>
  cache: CacheStore
  post: PanelPoster
  clock: Clock
  /** The cached list counts as stale after this long. Default 5 minutes. */
  staleAfterMs?: number
  /** List statuses are re-fetched after this long. Default 1 hour. */
  statusesMaxAgeMs?: number
  /** Spaces and Space children are re-fetched after this long. Default 1 hour. */
  hierarchyMaxAgeMs?: number
  /** `get(id, { reuseMs })` answers from a fetch at most this old. Default 30 s. */
  detailMemoMs?: number
}

export class TaskService {
  private readonly staleAfterMs: number
  private readonly statusesMaxAgeMs: number
  private readonly hierarchyMaxAgeMs: number
  private readonly detailMemoMs: number
  private inFlight: Promise<TaskListResult> | null = null
  /** Shared in-flight reads by key, so a double expand or double open costs one ClickUp call. */
  private readonly pending = new Map<string, Promise<unknown>>()
  /** Recently fetched details, so start.options reuses what tasks.get just fetched. */
  private readonly recent = new Map<string, { at: number; task: TaskDetail }>()

  /** The scope reads Space contents through this service, so it is attached after both exist. */
  setScope(scope: NonNullable<TaskServiceDeps['scope']>): void {
    this.deps.scope = scope
  }

  constructor(private readonly deps: TaskServiceDeps) {
    this.staleAfterMs = deps.staleAfterMs ?? 5 * 60_000
    this.statusesMaxAgeMs = deps.statusesMaxAgeMs ?? 60 * 60_000
    this.hierarchyMaxAgeMs = deps.hierarchyMaxAgeMs ?? 60 * 60_000
    this.detailMemoMs = deps.detailMemoMs ?? 30_000
  }

  private shared<T>(key: string, work: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key)
    if (existing) return existing as Promise<T>
    const promise = work().finally(() => this.pending.delete(key))
    this.pending.set(key, promise)
    return promise
  }

  /** Cached list; fetches when asked or when nothing is cached. Concurrent refreshes share one fetch. */
  async list(refresh: boolean): Promise<TaskListResult> {
    const { teamId } = await this.deps.auth.session()
    const scope = this.requireScope()
    if (scope.isEmpty(await scope.get())) return { tasks: [], fetchedAt: this.deps.clock(), stale: false, scopeEmpty: true }
    if (!refresh) {
      const cached = await this.deps.cache.readTasks(teamId)
      if (cached) {
        return { ...cached, stale: this.deps.clock() - cached.fetchedAt > this.staleAfterMs, scopeEmpty: false }
      }
    }
    this.inFlight ??= this.fetchList().finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }

  /**
   * From ClickUp, unless `reuse` is set and the same task was fetched within the memo window.
   * Also refreshes that task's row in the My Tasks cache.
   */
  async get(taskId: string, options: { reuse?: boolean } = {}): Promise<TaskDetail> {
    if (!taskId) throw new PluginError('invalid_input', 'No task id.')
    const memo = this.recent.get(taskId)
    if (options.reuse && memo && this.deps.clock() - memo.at <= this.detailMemoMs) return memo.task
    return this.shared(`task:${taskId}`, async () => {
      const tracker = await this.deps.auth.tracker()
      const task = await tracker.getTask(taskId)
      // Refused before it is cached, shown or used: a task of a List that is not chosen.
      await this.requireScope().assertList(task.list.id)
      this.remember(task)
      await this.deps.cache.patchTask(toSummary(task))
      return task
    })
  }

  /** Newest comments, or the page older than `before`. Never cached: comments change often. */
  async comments(taskId: string, before?: CommentCursor): Promise<CommentPage> {
    const tracker = await this.deps.auth.tracker()
    const key = `comments:${taskId}:${before ? `${before.start}:${before.startId}` : ''}`
    return this.shared(key, () => tracker.listComments(taskId, before))
  }

  /** Threaded replies of one comment. Never cached. */
  async replies(commentId: string): Promise<TaskComment[]> {
    const tracker = await this.deps.auth.tracker()
    return this.shared(`replies:${commentId}`, () => tracker.listReplies(commentId))
  }

  /** Spaces of the selected Workspace, cached for the hierarchy window. */
  async spaces(refresh: boolean): Promise<SpaceRef[]> {
    const { tracker, teamId } = await this.deps.auth.session()
    if (!refresh) {
      const cached = await this.deps.cache.readSpaces(teamId, this.deps.clock(), this.hierarchyMaxAgeMs)
      if (cached) return cached
    }
    return this.shared(`spaces:${teamId}`, async () => {
      const spaces = await tracker.listSpaces(teamId)
      await this.deps.cache.writeSpaces(teamId, this.deps.clock(), spaces)
      return spaces
    })
  }

  /** Folders and Lists of a Space, cached for the hierarchy window. */
  async children(spaceId: string, refresh: boolean): Promise<SpaceChildren> {
    const tracker = await this.deps.auth.tracker()
    if (!refresh) {
      const cached = await this.deps.cache.readChildren(spaceId, this.deps.clock(), this.hierarchyMaxAgeMs)
      if (cached) return cached
    }
    return this.shared(`children:${spaceId}`, async () => {
      const children = await tracker.listSpaceChildren(spaceId)
      await this.deps.cache.writeChildren(this.deps.clock(), children)
      return children
    })
  }

  /** One page of a List, always from ClickUp (Browse is an explicit look, not a background list). */
  async listTasks(listId: string, page: number, includeClosed: boolean): Promise<ListTasksPage> {
    await this.requireScope().assertList(listId)
    const tracker = await this.deps.auth.tracker()
    return this.shared(`list:${listId}:${page}:${includeClosed}`, async () => {
      const result = await tracker.listTasksInList(listId, { page, includeClosed })
      return { listId, page, tasks: result.tasks, lastPage: result.lastPage }
    })
  }

  /**
   * One page of the Workspace's tasks in `listIds` (the Tasks page's views other than "mine, open"),
   * always from ClickUp, deduped while in flight. Lists outside the scope are dropped before the
   * query, and tasks outside it after.
   */
  async queryTasks(params: {
    listIds: readonly string[]
    assigneeId?: string
    includeClosed: boolean
    statuses?: readonly string[]
    page: number
  }): Promise<{ tasks: TaskSummary[]; lastPage: boolean }> {
    const { tracker, teamId } = await this.deps.auth.session()
    const ids = await this.requireScope().listIds()
    const listIds = params.listIds.filter((id) => ids.has(id))
    if (listIds.length === 0) return { tasks: [], lastPage: true }
    const query = { ...params, listIds }
    return this.shared(`query:${teamId}:${JSON.stringify(query)}`, async () => {
      const result = await tracker.queryTasks(teamId, query)
      return { tasks: result.tasks.filter((t) => ids.has(t.list.id)), lastPage: result.lastPage }
    })
  }

  /** A List's statuses when they are cached, without asking ClickUp. */
  async cachedStatuses(listId: string): Promise<StatusOption[] | null> {
    return this.deps.cache.readStatuses(listId, this.deps.clock(), this.statusesMaxAgeMs)
  }

  /** Drops the task, status, Space and Folder caches and the in-memory detail memo (cache.clear). */
  async clearCaches(): Promise<void> {
    await this.deps.cache.clear()
    this.recent.clear()
  }

  private remember(task: TaskDetail): void {
    const now = this.deps.clock()
    for (const [id, entry] of this.recent) if (now - entry.at > this.detailMemoMs) this.recent.delete(id)
    this.recent.set(task.id, { at: now, task })
  }

  async statuses(listId: string): Promise<StatusOption[]> {
    if (!listId) throw new PluginError('invalid_input', 'No list id.')
    const now = this.deps.clock()
    const cached = await this.deps.cache.readStatuses(listId, now, this.statusesMaxAgeMs)
    if (cached) return cached
    const tracker = await this.deps.auth.tracker()
    const statuses = await tracker.listStatuses(listId)
    await this.deps.cache.writeStatuses(listId, now, statuses)
    return statuses
  }

  /** Status first, then comment: a failed comment never hides a status change that happened. */
  async update(request: UpdateTaskRequest): Promise<void> {
    if (!request.taskId) throw new PluginError('invalid_input', 'No task id.')
    const tracker = await this.deps.auth.tracker()
    this.recent.delete(request.taskId)
    if (request.status) await tracker.setStatus(request.taskId, request.status)
    const comment = request.comment?.trim()
    if (comment) await tracker.addComment(request.taskId, { text: comment, mentions: [] })
    if (request.status) {
      await this.get(request.taskId)
      this.deps.post('tasks.changed', { fetchedAt: this.deps.clock() })
    }
  }

  private async fetchList(): Promise<TaskListResult> {
    const { tracker, teamId, userId } = await this.deps.auth.session()
    const ids = await this.requireScope().listIds()
    // The query is limited to these Lists; the filter keeps it so even if ClickUp widened it.
    const tasks = (await tracker.listMyTasks(teamId, userId, { listIds: [...ids] })).filter((t) => ids.has(t.list.id))
    const fetchedAt = this.deps.clock()
    await this.deps.cache.writeTasks(teamId, fetchedAt, tasks)
    this.deps.post('tasks.changed', { fetchedAt })
    return { tasks, fetchedAt, stale: false, scopeEmpty: false }
  }

  private requireScope(): NonNullable<TaskServiceDeps['scope']> {
    const scope = this.deps.scope
    if (!scope) throw new PluginError('orca_failed', 'List scope is not wired.')
    return scope
  }
}

/** Drops detail-only fields so the cached list stays slim. */
export function toSummary(task: TaskDetail): TaskSummary {
  return {
    id: task.id,
    customId: task.customId,
    name: task.name,
    status: { ...task.status },
    priority: task.priority,
    dueDate: task.dueDate,
    url: task.url,
    list: { ...task.list },
    location: task.location,
    parentId: task.parentId,
    updatedAt: task.updatedAt,
    createdAt: task.createdAt,
    timeEstimateMs: task.timeEstimateMs
  }
}
