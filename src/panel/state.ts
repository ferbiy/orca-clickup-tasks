// Panel state: atoms only (components panels have no hooks). Views read these; only api.ts and
// panel.tsx's event handlers write them. Keyed atoms survive a hot reload.
import { atom, derived, read, type TreeItem } from 'orca'
import type { PluginErrorShape } from '../shared/errors'
import {
  activeFilterCount as countFilters, EMPTY_FILTER, matchesFilter, normalizeFilter, sortTasks, type TaskFilter
} from '../shared/task-filter'
import type {
  AuthState,
  EditableField,
  Person,
  SpaceChildren,
  SpaceRef,
  StartOptions,
  StatusOption,
  TaskComment,
  CommentCursor,
  ListStatusMapping,
  ProjectOption,
  Scope,
  TaskContextMode,
  TaskDetail,
  TaskLink,
  TaskListResult,
  TaskSummary
} from '../shared/model'

export type Screen = { name: 'list' } | { name: 'detail'; taskId: string; backTo: string | null }

/** A short message shown at the top of the current screen. */
export interface Notice {
  tone: 'success' | 'warning' | 'danger' | 'neutral'
  text: string
}

/** Persisted so a reopened panel returns to the open task (panel.tsx re-fetches it). */
export const screen = atom<Screen>('screen', { name: 'list' }, { persist: 'plugin' })
/** null until the worker first answers 'auth.state'. */
export const auth = atom<AuthState | null>('auth', null)
export const tasks = atom<TaskListResult | null>('tasks', null)
export const tasksError = atom<PluginErrorShape | null>('tasksError', null)
export const refreshing = atom<boolean>('refreshing', false)
/** Epoch ms before which Refresh stays disabled (after a rate limit). */
export const refreshBlockedUntil = atom<number>('refreshBlockedUntil', 0)
export const links = atom<TaskLink[]>('links', [])
export const notice = atom<Notice | null>('notice', null)
/** Label of the action in progress ("Connecting…", "Starting…"); disables the buttons that run one. */
export const busy = atom<string | null>('busy', null)

/** My tasks filters, remembered across panel runs. Always read through `normalizeFilter` (older state lacks fields). */
export const filter = atom<TaskFilter>('filter', EMPTY_FILTER, { persist: 'plugin' })

/** Whether each tab's filter box is open. Not persisted: a reopened panel starts compact. */
export const filtersOpen = atom<{ tasks: boolean; browse: boolean }>('filtersOpen', { tasks: false, browse: false })

/** Connect screen draft. Never persisted: it holds the token until submit. */
export const tokenDraft = atom<string>('tokenDraft', '')

/** The OAuth app form. Never persisted; the secret is cleared after every save attempt. */
export interface OAuthDraft {
  clientId: string
  clientSecret: string
  redirectUri: string
}
export const oauthDraft = atom<OAuthDraft>('oauthDraft', { clientId: '', clientSecret: '', redirectUri: '' })
/** True while the person edits a saved OAuth app (the form shows instead of the summary). */
export const oauthEditing = atom<boolean>('oauthEditing', false)
/** The address pasted back from the browser (paste fallback). Never persisted. */
export const oauthPaste = atom<string>('oauthPaste', '')
/** Shows the personal-token form on the Connect screen. */
export const showTokenForm = atom<boolean>('showTokenForm', false)

/** The Lists Orca may see; null until loaded. */
export type ScopeValue = Scope
export const scope = atom<Scope | null>('scope', null)
/** Unsaved edits to the chosen Lists (Settings › Lists); null: none. */
export const scopeDraft = atom<Scope | null>('scopeDraft', null)
/** Statuses and transitions per List, loaded when a List's mapping is opened. */
export const mappings = atom<Record<string, ListStatusMapping>>('mappings', {})

/** The task open in the detail screen and what it needs. */
export interface DetailState {
  taskId: string
  task: TaskDetail | null
  options: StartOptions | null
  statuses: StatusOption[] | null
  error: PluginErrorShape | null
}
export const detail = atom<DetailState | null>('detail', null)

/** The Start form's project Select value: the same id can exist on two hosts. */
export function projectKey(p: Pick<ProjectOption, 'id' | 'hostId'>): string {
  return `${p.hostId}::${p.id}`
}

export interface StartForm {
  projectKey: string
  agent: string
  baseBranch: string
  moveToInProgress: boolean
  taskContext: TaskContextMode
}
export const startForm = atom<StartForm>('startForm', {
  projectKey: '',
  agent: 'claude',
  baseBranch: '',
  moveToInProgress: true,
  taskContext: 'link-and-snapshot'
})

export interface UpdateForm {
  status: string
  comment: string
}
export const updateForm = atom<UpdateForm>('updateForm', { status: '', comment: '' })

/** The task prompt the run card shows for pasting by hand, once loaded. */
export const runPrompt = atom<{ workspaceId: string; text: string | null; error: string | null } | null>('runPrompt', null)


// ── Browse ─────────────────────────────────────────────────────────────────

export type Tab = 'tasks' | 'browse' | 'settings'
/** The list screen's active tab, remembered across panel runs. */
export const activeTab = atom<Tab>('activeTab', 'tasks', { persist: 'plugin' })

/** The List open in Browse (null: the tree shows), and whether closed tasks are included. */
export interface BrowseSelection {
  list: { id: string; name: string; breadcrumb: string } | null
  includeClosed: boolean
}
export const browseSelection = atom<BrowseSelection>('browseSelection', { list: null, includeClosed: false }, { persist: 'plugin' })

/** Open tree items (keys), kept here because Orca forgets them when the Tree unmounts. */
export const browseExpanded = atom<string[]>('browseExpanded', [], { persist: 'plugin' })

export interface BrowseTree {
  spaces: SpaceRef[] | null
  children: Record<string, SpaceChildren>
  loadingSpaces: boolean
  loadingChildren: string[]
  /** `spaceId` is set when the failed request was a Space's children. */
  error: { spaceId: string | null; shape: PluginErrorShape } | null
}
export const browseTree = atom<BrowseTree>('browseTree', {
  spaces: null,
  children: {},
  loadingSpaces: false,
  loadingChildren: [],
  error: null
})

/** The loaded pages of the open List (not persisted). */
export interface BrowseTasks {
  listId: string
  includeClosed: boolean
  tasks: TaskSummary[]
  /** The page the next "Load more" fetches. */
  nextPage: number
  lastPage: boolean
  loading: boolean
  error: PluginErrorShape | null
}
export const browseTasks = atom<BrowseTasks | null>('browseTasks', null)
/**
 * Filters for the open List; kept across Lists like "Show closed", separate from My tasks. `listId`
 * is always ''. The old 'browsePresets' key is abandoned: a first read starts from EMPTY_FILTER.
 */
export const browseFilter = atom<TaskFilter>('browseFilter', EMPTY_FILTER, { persist: 'plugin' })

/** The open task's comments, loaded apart from the task. */
export interface CommentsState {
  taskId: string
  comments: TaskComment[]
  next: CommentCursor | null
  loading: boolean
  error: PluginErrorShape | null
}
export const comments = atom<CommentsState | null>('comments', null)

/** Threaded replies per comment id, for the open task. Loaded when the person opens a thread. */
export interface RepliesState {
  open: boolean
  loading: boolean
  items: TaskComment[] | null
  error: PluginErrorShape | null
}
export const replies = atom<Record<string, RepliesState>>('replies', {}, { persist: 'plugin' })

/** Whether the open task's description shows in full. Reset when another task opens. */
export const descriptionExpanded = atom<boolean>('descriptionExpanded', false)

/** True while the detail's reload button is fetching. */
export const detailRefreshing = atom<boolean>('detailRefreshing', false)

// ── Detail editing (Phase 8a) ─────────────────────────────────────────────

/** One field edits at a time; 8a uses EditableField values, 8b adds wider keys. Persisted so an
 *  open editor survives a panel restart; `taskId` keeps it off other tasks. */
export interface EditingState {
  taskId: string
  field: string
  /** Identifies the row inside the field in 8b (checklist/item id). */
  key?: string
  draft: string
  error: string | null
}
export const editing = atom<EditingState | null>('editing', null, { persist: 'plugin' })

/** The description editor's tab while `editing.field === 'description'`. */
export const descriptionTab = atom<'write' | 'preview'>('descriptionTab', 'write', { persist: 'plugin' })

/** The open member picker (assignees, watchers; mention and comment pickers come with 8b). */
export interface PickerState {
  taskId: string
  kind: 'assignees' | 'watchers' | 'mention' | 'replyMention' | 'commentAssignee'
  query: string
  commentId?: string
}
export const picker = atom<PickerState | null>('picker', null, { persist: 'plugin' })

/** Fields ClickUp refused with 'forbidden', per task id; their controls render disabled. */
export const locked = atom<Record<string, EditableField[]>>('locked', {}, { persist: 'plugin' })

/** Fields with a write in flight; their controls show busy and stay disabled. */
export const saving = atom<EditableField[]>('saving', [])

/** Workspace members for the people pickers; loaded on first use, cached by the worker. */
export const members = atom<Person[] | null>('members', null)
export const membersLoading = atom<boolean>('membersLoading', false)

/** The open task's Space tag names, loaded when the tags row first edits. */
export const spaceTags = atom<{ spaceId: string; tags: string[] } | null>('spaceTags', null)
export const spaceTagsLoading = atom<boolean>('spaceTagsLoading', false)

/** A two-press delete in flight ('comment:ID' style keys; used from 8b). */
export const confirm = atom<string | null>('confirm', null, { persist: 'plugin' })

/** Comment composer/reply drafts by key ('new' or 'reply:<commentId>'); cleared on success. */
export const commentDrafts = atom<Record<string, string>>('commentDrafts', {})

/** People inserted as `@Name` per draft key; dropped if their `@Name` leaves the text. */
export const commentMentions = atom<Record<string, Person[]>>('commentMentions', {})

const folderKey = (id: string) => `folder:${id}`

/** Whether a List (in `spaceId`, maybe in `folderId`) is inside the chosen scope. */
export function listInScope(sc: Scope, spaceId: string, folderId: string | null, listId: string): boolean {
  return (
    sc.spaces.includes(spaceId) ||
    (folderId !== null && sc.folders.some((f) => f.id === folderId)) ||
    sc.lists.some((l) => l.id === listId)
  )
}

/** Whether anything in a Space is chosen (so Browse shows it). */
export function spaceTouched(sc: Scope, spaceId: string): boolean {
  return sc.spaces.includes(spaceId) || sc.folders.some((f) => f.spaceId === spaceId) || sc.lists.some((l) => l.spaceId === spaceId)
}

function countLabel(n: number | null): string | undefined {
  return n === null ? undefined : `${n} ${n === 1 ? 'task' : 'tasks'}`
}

/**
 * Tree rows limited to the chosen scope: Spaces with anything chosen (lazy), then their chosen
 * Folders (with their chosen Lists) and chosen folderless Lists. Nothing else is listed.
 */
export function treeItems(tree: BrowseTree, sc: Scope): TreeItem[] {
  return (tree.spaces ?? [])
    .filter((space) => spaceTouched(sc, space.id))
    .map((space) => {
      const kids = tree.children[space.id]
      const item: TreeItem = { key: `space:${space.id}`, label: space.name, icon: 'layers' }
      if (!kids) return { ...item, hasChildren: true }
      const listItem = (l: { id: string; name: string; taskCount: number | null }): TreeItem => ({
        key: `list:${l.id}`,
        label: l.name,
        icon: 'file-text',
        description: countLabel(l.taskCount)
      })
      return {
        ...item,
        children: [
          ...kids.folders
            .map((f) => ({ f, lists: f.lists.filter((l) => listInScope(sc, space.id, f.id, l.id)) }))
            .filter(({ lists }) => lists.length > 0)
            .map(({ f, lists }): TreeItem => ({ key: folderKey(f.id), label: f.name, icon: 'folder', children: lists.map(listItem) })),
          ...kids.lists.filter((l) => listInScope(sc, space.id, null, l.id)).map(listItem)
        ]
      }
    })
}

/** The List behind a `list:<id>` key, with its "Space › Folder" breadcrumb, from the loaded tree. */
export function findList(tree: BrowseTree, key: string): { id: string; name: string; breadcrumb: string } | null {
  if (!key.startsWith('list:')) return null
  const id = key.slice(5)
  for (const space of tree.spaces ?? []) {
    const kids = tree.children[space.id]
    if (!kids) continue
    const loose = kids.lists.find((l) => l.id === id)
    if (loose) return { id, name: loose.name, breadcrumb: space.name }
    for (const folder of kids.folders) {
      const hit = folder.lists.find((l) => l.id === id)
      if (hit) return { id, name: hit.name, breadcrumb: `${space.name} › ${folder.name}` }
    }
  }
  return null
}

// ── Derived ────────────────────────────────────────────────────────────────

export interface TaskGroup {
  status: string
  type: TaskSummary['status']['type']
  tasks: TaskSummary[]
}

const RANK: Record<TaskSummary['status']['type'], number> = { custom: 0, unstarted: 1, open: 2, done: 3, closed: 4 }

/** Tasks passing the filter (search, List, presets, priority, due), grouped by status in workflow order (custom → open → done/closed); each group sorted by `f.sort`. */
export function groupTasks(tasks: readonly TaskSummary[], f: TaskFilter, now: number): TaskGroup[] {
  const groups = new Map<string, TaskGroup>()
  for (const t of tasks) {
    if (!matchesFilter(t, f, now)) continue
    const key = t.status.name.toLowerCase()
    const group = groups.get(key) ?? { status: t.status.name, type: t.status.type, tasks: [] }
    group.tasks.push(t)
    groups.set(key, group)
  }
  for (const g of groups.values()) g.tasks = sortTasks(g.tasks, f.sort)
  return [...groups.values()].sort((a, b) => RANK[a.type] - RANK[b.type] || a.status.localeCompare(b.status))
}

/** The normalized My tasks filter. */
export const tasksFilter = derived<TaskFilter>(() => normalizeFilter(read(filter)))

/** The normalized Browse filter (its List is the screen, so `listId` is ignored). */
export const browseFilterValue = derived<TaskFilter>(() => ({ ...normalizeFilter(read(browseFilter)), listId: '' }))

/** My tasks after the filters, grouped by status. */
export const groupedTasks = derived<TaskGroup[]>(() => {
  const result = read(tasks)
  return result ? groupTasks(result.tasks, read(tasksFilter), Date.now()) : []
})

/** How many filters are on in My tasks. */
export const activeFilterCount = derived<number>(() => countFilters(read(tasksFilter)))

/** Tasks that pass the filters (the "X" of "X of Y open tasks"). */
export const filteredCount = derived<number>(() => read(groupedTasks).reduce((n, g) => n + g.tasks.length, 0))

/** The loaded Browse tasks after the filters, grouped by status. */
export const browseGroups = derived<TaskGroup[]>(() => {
  const page = read(browseTasks)
  return page ? groupTasks(page.tasks, read(browseFilterValue), Date.now()) : []
})

/** Browse filters on, including "Show closed" (it changes what is fetched, so it counts). */
export const browseActiveFilterCount = derived<number>(() => countFilters(read(browseFilterValue)) + (read(browseSelection).includeClosed ? 1 : 0))

/** Loaded Browse tasks that pass the filters (the "X" of "X of Y tasks loaded"). */
export const browseFilteredCount = derived<number>(() => read(browseGroups).reduce((n, g) => n + g.tasks.length, 0))

/** The Lists present in the loaded tasks, for the filter Select. */
export const listOptions = derived(() => {
  const seen = new Map<string, string>()
  for (const t of read(tasks)?.tasks ?? []) seen.set(t.list.id, t.location)
  return [...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
})

/** Newest link per task id. */
export const linkByTask = derived(() => {
  const map = new Map<string, TaskLink>()
  for (const l of read(links)) if (!map.has(l.taskId)) map.set(l.taskId, l)
  return map
})
