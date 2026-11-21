// Panel actions: the only panel code that calls plugin.request or writes atoms after a reply.
// Views call these functions from onPress/onChange handlers and never talk to the worker themselves.
import { plugin, read, set, shell, update, type PluginRequests } from 'orca'
import { fromErrorShape, type ErrorCode, messageOf, PluginError, toErrorShape } from '../shared/errors'
import type { Result } from '../shared/errors'
import { doneCommentTemplate } from '../shared/display'
import type { TaskContextMode, TaskLink, TaskSummary } from '../shared/model'
import { pickReviewStatus } from '../shared/status-pick'
import { EMPTY_FILTER, normalizeFilter, normalizePresets, type TaskFilter, type TaskPreset } from '../shared/task-filter'
import * as s from './state'
import { loadSettings, settingsSaving, settingsState } from './settings'

type Name = keyof PluginRequests
type Value<K extends Name> = PluginRequests[K] extends { output: Result<infer T> } ? T : never
type Input<K extends Name> = PluginRequests[K] extends { input: infer I } ? I : undefined

/** plugin.request with the Result envelope unwrapped: resolves the value or throws PluginError. */
export async function call<K extends Name>(name: K, ...input: Input<K> extends undefined ? [] : [Input<K>]): Promise<Value<K>> {
  const request = plugin.request as unknown as (n: string, i?: unknown, o?: { timeoutMs?: number }) => Promise<Result<Value<K>>>
  let answer: Result<Value<K>>
  try {
    answer = await request(name, input[0], { timeoutMs: name === 'start.run' ? 120_000 : 30_000 })
  } catch (error) {
    throw new PluginError('orca_failed', messageOf(error))
  }
  if (!answer.ok) throw fromErrorShape(answer.error)
  return answer.value
}

export const MESSAGES: Record<ErrorCode, string> = {
  not_connected: 'Connect ClickUp to continue.',
  auth_invalid: 'ClickUp refused the token. Paste a new one.',
  rate_limited: 'ClickUp is rate limiting requests. Try again in a minute.',
  clickup_unavailable: 'Could not reach ClickUp. Check your connection and refresh.',
  not_found: 'That item no longer exists or you lost access to it.',
  invalid_input: 'That did not look right.',
  forbidden: 'Your ClickUp plan does not allow that. Locked fields stay read-only.',
  conflict: 'This task changed in ClickUp. It was reloaded; your text is kept.',
  secrets_unavailable: 'This system has no keychain, so the token cannot be stored safely.',
  orca_failed: 'Orca could not finish that action.'
}

/** What to show for an error: ClickUp's own wording for input errors, a fixed sentence otherwise. */
export function messageFor(error: unknown): string {
  const shape = toErrorShape(error)
  return shape.code === 'invalid_input' || shape.code === 'orca_failed' ? shape.message || MESSAGES[shape.code] : MESSAGES[shape.code]
}

async function run<T>(label: string, work: () => Promise<T>): Promise<T | undefined> {
  set(s.busy, label)
  set(s.notice, null)
  try {
    return await work()
  } catch (error) {
    const shape = toErrorShape(error)
    if (shape.code === 'auth_invalid' || shape.code === 'not_connected') void loadAuth()
    set(s.notice, { tone: 'danger', text: messageFor(error) })
    return undefined
  } finally {
    set(s.busy, null)
  }
}

// ── Auth ───────────────────────────────────────────────────────────────────

export async function loadAuth(): Promise<void> {
  try {
    set(s.auth, await call('auth.state'))
  } catch (error) {
    set(s.notice, { tone: 'danger', text: messageFor(error) })
  }
}

export async function connect(): Promise<void> {
  const token = read(s.tokenDraft)
  const state = await run('Connecting…', () => call('auth.connect', { token }))
  if (!state) return
  set(s.tokenDraft, '')
  set(s.auth, state)
  if (state.teamId) await loadTasks(false)
}

export async function disconnect(): Promise<void> {
  const state = await run('Disconnecting…', () => call('auth.disconnect'))
  if (!state) return
  set(s.auth, state)
  set(s.tasks, null)
  set(s.screen, { name: 'list' })
  resetBrowse()
}

export async function selectTeam(teamId: string): Promise<void> {
  const state = await run('Switching Workspace…', () => call('auth.selectTeam', { teamId }))
  if (!state) return
  set(s.auth, state)
  set(s.tasks, null)
  resetBrowse()
  await loadTasks(true)
  if (read(s.activeTab) === 'browse') void ensureBrowse()
}

// ── Tasks ──────────────────────────────────────────────────────────────────

/** Cached list first; refreshes once when it is stale. */
export async function loadTasks(refresh: boolean): Promise<void> {
  if (refresh && Date.now() < read(s.refreshBlockedUntil)) return
  set(s.refreshing, true)
  try {
    const result = await call('tasks.list', { refresh })
    set(s.tasks, result)
    set(s.tasksError, null)
    if (result.stale && !refresh) await loadTasks(true)
  } catch (error) {
    const shape = toErrorShape(error)
    set(s.tasksError, shape)
    if (shape.code === 'rate_limited') set(s.refreshBlockedUntil, Date.now() + (shape.retryAfterMs ?? 60_000))
    if (shape.code === 'auth_invalid' || shape.code === 'not_connected') void loadAuth()
  } finally {
    set(s.refreshing, false)
  }
}

export async function loadLinks(): Promise<void> {
  try {
    set(s.links, await call('links.list'))
  } catch {
    // Links are a hint on the list; the next link.changed event fills them in.
  }
}

function withPreset(f: TaskFilter, id: TaskPreset): TaskFilter {
  const on = normalizePresets(f.presets)
  return { ...f, presets: normalizePresets(on.includes(id) ? on.filter((p) => p !== id) : [...on, id]) }
}

/** Changes some My tasks filter fields. */
export function patchFilter(patch: Partial<TaskFilter>): void {
  update(s.filter, (f) => normalizeFilter({ ...normalizeFilter(f), ...patch }))
}

export function togglePreset(id: TaskPreset): void {
  update(s.filter, (f) => withPreset(normalizeFilter(f), id))
}

export function clearFilters(): void {
  set(s.filter, EMPTY_FILTER)
}

/** Opens or closes a tab's filter box. */
export function toggleFiltersOpen(which: 'tasks' | 'browse'): void {
  update(s.filtersOpen, (o) => ({ ...o, [which]: !o[which] }))
}

// ── Detail, start, update ────────────────────────────────────────────────

export async function openTask(taskId: string, backTo: string | null = null): Promise<void> {
  set(s.screen, { name: 'detail', taskId, backTo })
  set(s.notice, null)
  set(s.detail, { taskId, task: null, options: null, statuses: null, error: null })
  set(s.replies, {})
  set(s.descriptionExpanded, false)
  if (read(s.editing)?.taskId !== taskId) set(s.editing, null)
  if (read(s.picker)?.taskId !== taskId) set(s.picker, null)
  set(s.spaceTags, null)
  void loadComments(taskId, false)
  try {
    const [task, options] = await Promise.all([call('tasks.get', { taskId }), call('start.options', { taskId })])
    const statuses = await call('tasks.statuses', { listId: task.list.id })
    if (!isOpen(taskId)) return
    set(s.detail, { taskId, task, options, statuses, error: null })
    set(s.startForm, {
      projectId: options.suggestedProjectId ?? options.projects[0]?.id ?? '',
      agent: options.defaults.agent,
      baseBranch: options.defaults.baseBranch,
      moveToInProgress: options.defaults.moveToInProgress,
      taskContext: options.defaults.taskContext
    })
    const link = read(s.linkByTask).get(taskId)
    set(s.retryAgent, '')
    if (link && link.run.state !== 'done') void checkRuns(link.workspaceId)
    set(s.updateForm, {
      status: pickReviewStatus(statuses, task.status.name) ?? task.status.name,
      comment: link ? doneCommentTemplate(agentLabelOf(link, options.agents), link.branch) : ''
    })
  } catch (error) {
    update(s.detail, (d) => (d && d.taskId === taskId ? { ...d, error: toErrorShape(error) } : d))
  }
}

export function isOpen(taskId: string): boolean {
  const screen = read(s.screen)
  return screen.name === 'detail' && screen.taskId === taskId
}

/** The newest comments of a task, or the next older page. Answers for a task no longer open are dropped. */
export async function loadComments(taskId: string, older: boolean): Promise<void> {
  const before = older ? read(s.comments)?.next ?? undefined : undefined
  if (older && !before) return
  // A reload keeps the comments on screen until the fresh page arrives.
  update(s.comments, (c) =>
    c && c.taskId === taskId ? { ...c, loading: true, error: null } : { taskId, comments: [], next: null, loading: true, error: null }
  )
  try {
    const page = await call('tasks.comments', { taskId, ...(before ? { before } : {}) })
    if (!isOpen(taskId) || read(s.comments)?.taskId !== taskId) return
    update(s.comments, (c) =>
      c ? { ...c, comments: older ? [...c.comments, ...page.comments] : page.comments, next: page.next, loading: false, error: null } : c
    )
  } catch (error) {
    if (!isOpen(taskId) || read(s.comments)?.taskId !== taskId) return
    update(s.comments, (c) => (c ? { ...c, loading: false, error: toErrorShape(error) } : c))
  }
}

export function toggleDescription(): void {
  update(s.descriptionExpanded, (open) => !open)
}

/** Opens or closes a comment's thread; opening fetches its replies (fresh each time). */
export async function toggleReplies(commentId: string): Promise<void> {
  const current = read(s.replies)[commentId]
  if (current?.open) {
    update(s.replies, (all) => ({ ...all, [commentId]: { ...current, open: false } }))
    return
  }
  const taskId = read(s.comments)?.taskId
  update(s.replies, (all) => ({
    ...all,
    [commentId]: { open: true, loading: true, items: current?.items ?? null, error: null }
  }))
  try {
    const items = await call('tasks.replies', { commentId })
    if (!taskId || !isOpen(taskId)) return
    update(s.replies, (all) => (all[commentId] ? { ...all, [commentId]: { ...all[commentId]!, loading: false, items, error: null } } : all))
  } catch (error) {
    if (!taskId || !isOpen(taskId)) return
    update(s.replies, (all) =>
      all[commentId] ? { ...all, [commentId]: { ...all[commentId]!, loading: false, error: toErrorShape(error) } } : all
    )
  }
}

/** Fetches a failed thread again, keeping it open. */
export async function retryReplies(commentId: string): Promise<void> {
  update(s.replies, (all) => {
    const { [commentId]: _gone, ...rest } = all
    return rest
  })
  await toggleReplies(commentId)
}

/**
 * Re-fetches the open task, its statuses, comments and open threads, keeping what is on screen
 * (forms, expanded description) until the answers arrive.
 */
export async function reloadTask(): Promise<void> {
  const d = read(s.detail)
  const screen = read(s.screen)
  if (!d || screen.name !== 'detail' || read(s.detailRefreshing)) return
  if (!d.task) {
    await openTask(d.taskId, screen.backTo)
    return
  }
  const taskId = d.taskId
  const openLink = read(s.linkByTask).get(taskId)
  if (openLink && openLink.run.state !== 'done') void checkRuns(openLink.workspaceId)
  const openThreads = Object.entries(read(s.replies)).filter(([, r]) => r.open).map(([id]) => id)
  set(s.detailRefreshing, true)
  set(s.notice, null)
  void loadComments(taskId, false)
  try {
    const task = await call('tasks.get', { taskId })
    const statuses = await call('tasks.statuses', { listId: task.list.id })
    if (!isOpen(taskId)) return
    update(s.detail, (x) => (x && x.taskId === taskId ? { ...x, task, statuses, error: null } : x))
    patchRows(task)
    set(s.replies, {})
    for (const id of openThreads) void toggleReplies(id)
  } catch (error) {
    if (isOpen(taskId)) set(s.notice, { tone: 'danger', text: messageFor(error) })
  } finally {
    set(s.detailRefreshing, false)
  }
}

/** Back to the parent task when this one was opened from it, else to the list (on the tab that was active). */
export function back(): void {
  const screen = read(s.screen)
  const parent = screen.name === 'detail' ? screen.backTo : null
  if (parent) {
    void openTask(parent)
    return
  }
  set(s.screen, { name: 'list' })
  set(s.detail, null)
  set(s.comments, null)
  set(s.replies, {})
  set(s.notice, null)
}

export function patchStartForm(patch: Partial<s.StartForm>): void {
  update(s.startForm, (f) => ({ ...f, ...patch }))
}

export function patchRetryAgent(agent: string): void {
  set(s.retryAgent, agent)
}

export function patchUpdateForm(patch: Partial<s.UpdateForm>): void {
  update(s.updateForm, (f) => ({ ...f, ...patch }))
}

export async function startTask(): Promise<void> {
  const d = read(s.detail)
  const form = read(s.startForm)
  if (!d?.task || !form.projectId) return
  const link = await run('Starting…', () =>
    call('start.run', {
      taskId: d.task!.id,
      projectId: form.projectId,
      agent: form.agent,
      ...(form.baseBranch.trim() ? { baseBranch: form.baseBranch.trim() } : {}),
      moveToInProgress: form.moveToInProgress,
      taskContext: form.taskContext
    })
  )
  if (!link) return
  upsertLink(link)
  set(s.notice, { tone: 'success', text: `Workspace ${link.branch} created. The agent is starting.` })
}

export async function openWorkspace(workspaceId: string): Promise<void> {
  await run('Opening…', () => call('links.open', { workspaceId }))
}

/**
 * Asks the worker to look at runs Orca's events may have left behind (one, or all not done).
 * Quiet: the run card shows what it finds; a failure leaves the links as they were.
 */
export async function checkRuns(workspaceId?: string): Promise<void> {
  try {
    set(s.links, await call('runs.check', workspaceId ? { workspaceId } : {}))
  } catch {
    // Best effort, like loadLinks.
  }
}

/** "Check again" on the run card: the same check, with the busy label so the press shows. */
export async function checkRunNow(workspaceId: string): Promise<void> {
  await run('Checking…', () => checkRuns(workspaceId))
}

/** Starts `agent` again in the run's worktree (same branch), with the task prompt. */
export async function retryRun(workspaceId: string, agent: string): Promise<void> {
  const link = await run('Starting…', () => call('runs.retry', { workspaceId, agent }))
  if (!link) return
  upsertLink(link)
  set(s.retryAgent, '')
  set(s.notice, { tone: 'success', text: `Starting ${agentLabelOf(link, read(s.detail)?.options?.agents ?? [])} in ${link.branch}.` })
}

/**
 * Types the task prompt into the run's agent ("Send the task prompt" / "Send the task details",
 * the latter with `taskContext: 'snapshot-only'`). Orca switches to the workspace to do it.
 */
export async function sendRunPrompt(workspaceId: string, taskContext?: TaskContextMode): Promise<void> {
  const link = await run('Sending the prompt…', () =>
    call('runs.sendPrompt', { workspaceId, ...(taskContext ? { taskContext } : {}) })
  )
  if (!link) return
  upsertLink(link)
  set(s.notice, { tone: 'success', text: 'Prompt sent. Orca switched to the workspace to type it.' })
}

/** Loads the task prompt for pasting by hand (the run card's "Task prompt" section). */
export async function loadRunPrompt(workspaceId: string): Promise<void> {
  if (read(s.runPrompt)?.workspaceId === workspaceId && read(s.runPrompt)?.text) return
  set(s.runPrompt, { workspaceId, text: null, error: null })
  try {
    const { text } = await call('runs.prompt', { workspaceId })
    set(s.runPrompt, { workspaceId, text, error: null })
  } catch (error) {
    set(s.runPrompt, { workspaceId, text: null, error: messageFor(error) })
  }
}

/** Stops tracking a run; the worktree stays. The Start form shows again. */
export async function forgetRun(workspaceId: string): Promise<void> {
  const done = await run('Removing…', () => call('runs.forget', { workspaceId }))
  if (!done) return
  removeLink(workspaceId)
  set(s.notice, { tone: 'neutral', text: 'Stopped tracking that run. Its worktree is still in Orca.' })
}

export async function submitUpdate(): Promise<void> {
  const d = read(s.detail)
  const form = read(s.updateForm)
  if (!d?.task) return
  const statusChanged = form.status && form.status !== d.task.status.name
  if (!statusChanged && !form.comment.trim()) return
  const done = await run('Updating…', () =>
    call('tasks.update', {
      taskId: d.task!.id,
      ...(statusChanged ? { status: form.status } : {}),
      comment: form.comment
    })
  )
  if (!done) return
  set(s.notice, { tone: 'success', text: 'Task updated in ClickUp.' })
  const screen = read(s.screen)
  await openTask(d.task.id, screen.name === 'detail' ? screen.backTo : null)
  const fresh = read(s.detail)?.task
  if (fresh && fresh.id === d.task.id) patchRows(fresh)
}

/** Keeps the loaded My tasks and Browse rows in step with a task just fetched. */
export function patchRows(task: TaskSummary): void {
  const patch = (t: TaskSummary): TaskSummary =>
    t.id === task.id ? { ...t, status: task.status, name: task.name, priority: task.priority, dueDate: task.dueDate } : t
  update(s.browseTasks, (b) => (b && b.tasks.some((t) => t.id === task.id) ? { ...b, tasks: b.tasks.map(patch) } : b))
  update(s.tasks, (r) => (r && r.tasks.some((t) => t.id === task.id) ? { ...r, tasks: r.tasks.map(patch) } : r))
}

/** Only from a press: Orca refuses openExternal without a user gesture. */
export async function openInClickUp(url: string): Promise<void> {
  if (!/^https:\/\/app\.clickup\.com\//.test(url)) return
  await shell.openExternal(url)
}

/** Copies the open task's link; the notice says whether it worked. */
export async function copyTaskUrl(url: string): Promise<void> {
  const done = await run('Copying…', () => call('clipboard.copyTaskUrl', { url }))
  if (done) set(s.notice, { tone: 'success', text: 'Task link copied.' })
}

/** Only from a press. Opens the token help page; any other url is ignored. */
export async function openExternalLink(url: string): Promise<void> {
  if (!url.startsWith('https://developer.clickup.com/')) return
  await shell.openExternal(url)
}

/** Only from a press, and only for an https url of the open task's attachments. */
export async function openAttachment(id: string): Promise<void> {
  const url = read(s.detail)?.task?.attachments.find((a) => a.id === id)?.url
  if (!url || !url.startsWith('https://')) {
    set(s.notice, { tone: 'warning', text: 'That attachment has no safe link to open.' })
    return
  }
  await shell.openExternal(url)
}

// ── Browse ─────────────────────────────────────────────────────────────────

let browseRun = 0
let listRun = 0

export function resetBrowse(): void {
  browseRun++
  listRun++
  set(s.browseTree, { spaces: null, children: {}, loadingSpaces: false, loadingChildren: [], error: null })
  set(s.browseSelection, { list: null, includeClosed: false })
  set(s.browseExpanded, [])
  set(s.browseTasks, null)
}

export function setTab(tab: s.Tab): void {
  set(s.activeTab, tab)
  if (tab === 'browse') void ensureBrowse()
  if (tab === 'settings') ensureSettings()
}

/** Loads the settings the first time the Settings tab shows (a failed load is retried from its Retry button). */
export function ensureSettings(): void {
  if (!read(settingsState) && !read(settingsSaving)) void loadSettings()
}

/** Loads what the Browse tab shows when it has not loaded yet. */
export async function ensureBrowse(): Promise<void> {
  const { list, includeClosed } = read(s.browseSelection)
  if (list) {
    const page = read(s.browseTasks)
    if (!page || page.listId !== list.id || page.includeClosed !== includeClosed) await loadBrowsePage(true)
    return
  }
  if (!read(s.browseTree).spaces && !read(s.browseTree).loadingSpaces) await loadSpaces(false)
}

export async function loadSpaces(refresh: boolean): Promise<void> {
  const run = browseRun
  update(s.browseTree, (b) => ({ ...b, loadingSpaces: true, error: null }))
  try {
    const spaces = await call('browse.spaces', { refresh })
    if (run !== browseRun) return
    update(s.browseTree, (b) => ({ ...b, spaces, loadingSpaces: false }))
    // Spaces left open from the last run need their children again.
    for (const key of read(s.browseExpanded)) {
      if (key.startsWith('space:')) void loadChildren(key.slice(6), refresh)
    }
  } catch (error) {
    if (run !== browseRun) return
    update(s.browseTree, (b) => ({ ...b, loadingSpaces: false, error: { spaceId: null, shape: toErrorShape(error) } }))
  }
}

/** Fetches a Space's Folders and Lists once; later expands reuse what is loaded. */
export async function loadChildren(spaceId: string, refresh = false): Promise<void> {
  const tree = read(s.browseTree)
  if (tree.loadingChildren.includes(spaceId) || (!refresh && tree.children[spaceId])) return
  const run = browseRun
  update(s.browseTree, (b) => ({ ...b, loadingChildren: [...b.loadingChildren, spaceId], error: null }))
  try {
    const children = await call('browse.children', { spaceId, ...(refresh ? { refresh } : {}) })
    if (run !== browseRun) return
    update(s.browseTree, (b) => ({
      ...b,
      children: { ...b.children, [spaceId]: children },
      loadingChildren: b.loadingChildren.filter((id) => id !== spaceId)
    }))
  } catch (error) {
    if (run !== browseRun) return
    update(s.browseTree, (b) => ({
      ...b,
      loadingChildren: b.loadingChildren.filter((id) => id !== spaceId),
      error: { spaceId, shape: toErrorShape(error) }
    }))
  }
}

export function toggleTreeItem(key: string, expanded: boolean): void {
  update(s.browseExpanded, (open) => (expanded ? [...open.filter((k) => k !== key), key] : open.filter((k) => k !== key)))
  if (expanded && key.startsWith('space:')) void loadChildren(key.slice(6))
}

/** A press on a row: a List opens; a Space or Folder opens or closes, like its arrow. */
export function selectTreeItem(key: string): void {
  const list = s.findList(read(s.browseTree), key)
  if (list) {
    void openList(list)
    return
  }
  if (key.startsWith('space:') || key.startsWith('folder:')) toggleTreeItem(key, !read(s.browseExpanded).includes(key))
}

export async function openList(list: { id: string; name: string; breadcrumb: string }): Promise<void> {
  set(s.browseSelection, { list, includeClosed: read(s.browseSelection).includeClosed })
  await loadBrowsePage(true)
}

export function closeList(): void {
  listRun++
  update(s.browseSelection, (b) => ({ ...b, list: null }))
  set(s.browseTasks, null)
  void ensureBrowse()
}

export function setIncludeClosed(includeClosed: boolean): void {
  update(s.browseSelection, (b) => ({ ...b, includeClosed }))
  void loadBrowsePage(true)
}

/** Changes some Browse filter fields (the List is the screen, so `listId` stays empty). */
export function patchBrowseFilter(patch: Partial<TaskFilter>): void {
  update(s.browseFilter, (f) => ({ ...normalizeFilter({ ...normalizeFilter(f), ...patch }), listId: '' }))
}

export function toggleBrowsePreset(id: TaskPreset): void {
  update(s.browseFilter, (f) => withPreset(normalizeFilter(f), id))
}

/** Resets every Browse filter and turns "Show closed" off (which refetches); the open List stays. */
export function clearBrowseFilters(): void {
  set(s.browseFilter, EMPTY_FILTER)
  if (read(s.browseSelection).includeClosed) setIncludeClosed(false)
}

/** Page 0 replaces what is loaded; later pages append. */
export async function loadBrowsePage(reset: boolean): Promise<void> {
  const { list, includeClosed } = read(s.browseSelection)
  if (!list) return
  const current = read(s.browseTasks)
  if (!reset && (!current || current.loading || current.lastPage || current.listId !== list.id)) return
  const run = ++listRun
  const page = reset ? 0 : current!.nextPage
  update(s.browseTasks, (b) =>
    reset || !b
      ? { listId: list.id, includeClosed, tasks: [], nextPage: 0, lastPage: false, loading: true, error: null }
      : { ...b, loading: true, error: null }
  )
  try {
    const result = await call('browse.tasks', { listId: list.id, page, includeClosed })
    if (run !== listRun) return
    update(s.browseTasks, (b) => {
      if (!b || b.listId !== list.id) return b
      const known = new Set(reset ? [] : b.tasks.map((t) => t.id))
      const fresh = result.tasks.filter((t) => !known.has(t.id))
      return { ...b, tasks: reset ? fresh : [...b.tasks, ...fresh], nextPage: page + 1, lastPage: result.lastPage, loading: false }
    })
  } catch (error) {
    if (run !== listRun) return
    update(s.browseTasks, (b) => (b ? { ...b, loading: false, error: toErrorShape(error) } : b))
  }
}

/** The header Refresh: the active tab's data. */
export async function refreshActive(): Promise<void> {
  void checkRuns()
  if (read(s.activeTab) === 'tasks') return loadTasks(true)
  if (read(s.browseSelection).list) return loadBrowsePage(true)
  update(s.browseTree, (b) => ({ ...b, children: {} }))
  await loadSpaces(true)
}

// ── Event handlers (wired in panel.tsx setup) ─────────────────────────────

export function upsertLink(link: TaskLink): void {
  update(s.links, (all) => [link, ...all.filter((l) => l.workspaceId !== link.workspaceId)])
  // The agent can finish while its task is open: prefill the Done form once, never over edits.
  const d = read(s.detail)
  if (link.run.state === 'done' && d?.task?.id === link.taskId && d.options && !read(s.updateForm).comment) {
    const status = d.statuses ? pickReviewStatus(d.statuses, d.task.status.name) : null
    update(s.updateForm, (f) => ({
      status: f.status || status || d.task!.status.name,
      comment: doneCommentTemplate(agentLabelOf(link, d.options!.agents), link.branch)
    }))
  }
}

export function removeLink(workspaceId: string): void {
  update(s.links, (all) => all.filter((l) => l.workspaceId !== workspaceId))
}

function agentLabelOf(link: TaskLink, agents: readonly { id: string; label: string }[]): string {
  return agents.find((a) => a.id === link.agent)?.label ?? link.agent
}
