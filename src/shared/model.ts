// Domain model shared by the panel and the worker. Pure types: no Orca, no Node, no ClickUp DTOs.
// Every value here crosses plugin.request as JSON, so keep it plain data (no Date, Map, class).

/** Priority as ClickUp names it; null when the task has none. */
export type Priority = 'urgent' | 'high' | 'normal' | 'low'

/** A status of a ClickUp List. `type` drives "which status means in progress / done". */
export interface StatusOption {
  name: string
  /** ClickUp status type: 'open' (first), 'custom' (middle), 'done', 'closed'. */
  type: 'open' | 'custom' | 'done' | 'closed'
  /** Position in the List's workflow, lowest first. */
  order: number
}

/** Slim row for the task list. Keep it small: the list answer must stay well under 1 MiB. */
export interface TaskSummary {
  id: string
  /** Custom task id (e.g. "ENG-142") when the Workspace uses them, else null. */
  customId: string | null
  name: string
  status: { name: string; type: StatusOption['type'] }
  priority: Priority | null
  /** Epoch ms, or null. */
  dueDate: number | null
  url: string
  list: { id: string; name: string }
  /** "Space › List" style breadcrumb label for display. */
  location: string
  /** Parent task id when this is a subtask. */
  parentId: string | null
  /** Epoch ms of the last change in ClickUp. */
  updatedAt: number
  /** Epoch ms the task was created, or null when ClickUp does not say. Drives the "Created today" filter. */
  createdAt: number | null
  /** Milliseconds, or null when not set (0 counts as not set). Drives the "No time estimate" filter. */
  timeEstimateMs: number | null
}

export interface ChecklistItem {
  id: string
  name: string
  resolved: boolean
}

/** A task checklist; items flattened in orderindex order, children right after their parent. */
export interface Checklist {
  id: string
  name: string
  items: ChecklistItem[]
}

/** A task's subtask as the parent's `subtasks` entry shows it. */
export interface SubtaskRef {
  id: string
  name: string
  status: { name: string; type: StatusOption['type'] }
}

/** A ClickUp member as the panel shows them. */
export interface Person {
  id: string
  name: string
  /** Two-letter initials ClickUp computes, or derived from the name. */
  initials: string
}

/** A file attached to a task. `url` is ClickUp's https download link. */
export interface Attachment {
  id: string
  title: string
  url: string
  /** Lower-case extension without the dot ("png"), or null. */
  extension: string | null
  /** Bytes, or null when ClickUp does not say. */
  size: number | null
  /** Epoch ms, or null. */
  createdAt: number | null
}

/** Full task, fetched on demand for the detail view and the agent prompt. */
export interface TaskDetail extends TaskSummary {
  /** Markdown description; may be empty. Untrusted text. */
  description: string
  checklists: Checklist[]
  subtasks: SubtaskRef[]
  tags: string[]
  assignees: Person[]
  watchers: Person[]
  /** Epoch ms of the start date, or null. */
  startDate: number | null
  /** The Space this task's List lives in, when ClickUp says. */
  spaceId: string | null
  /** Milliseconds tracked so far, or null when none. */
  timeSpentMs: number | null
  attachments: Attachment[]
  /** Simple custom fields with a value, for the agent prompt's snapshot. Untrusted text. */
  customFields: { name: string; value: string }[]
}

/** One task comment (newest first in a page). Untrusted text. */
export interface TaskComment {
  id: string
  author: Person | null
  /** Plain text of the comment, built from its rich segments (a mention shows as @Name). */
  text: string
  /** The member the comment is assigned to, or null. */
  assignee: Person | null
  /** True once an assigned comment was resolved. */
  resolved: boolean
  /** Epoch ms. */
  createdAt: number
  /** Number of threaded replies (not loaded). */
  replyCount: number
}

/** A date the person set: `hasTime` false means date-only (ClickUp stores it at 04:00 local). */
export interface DateValue {
  at: number
  hasTime: boolean
}

/** One patch to PUT /task/{id}; every key optional, only the given ones are sent. */
export interface TaskPatch {
  name?: string
  /** Markdown; '' clears the description. */
  markdownDescription?: string
  status?: string
  /** urgent=1 high=2 normal=3 low=4 on the wire; null clears. */
  priority?: Priority | null
  dueDate?: DateValue | null
  startDate?: DateValue | null
  timeEstimateMs?: number | null
  assignees?: { add: string[]; remove: string[] }
  watchers?: { add: string[]; remove: string[] }
  /** Makes this task a subtask of that task. */
  parentId?: string
}

/** The fields the panel can lock after ClickUp refused a write ('forbidden'). */
export type EditableField =
  | 'name'
  | 'description'
  | 'status'
  | 'priority'
  | 'dueDate'
  | 'startDate'
  | 'timeEstimate'
  | 'assignees'
  | 'watchers'
  | 'tags'
  | 'parent'
  | 'checklists'
  | 'subtasks'
  | 'comments'

/** A new comment: plain text plus the people its @names mention. */
export interface CommentInput {
  text: string
  mentions: Person[]
}

/** One checklist write; the adapter turns it into the matching endpoint call. */
export type ChecklistAction =
  | { kind: 'create'; name: string }
  | { kind: 'rename'; checklistId: string; name: string }
  | { kind: 'delete'; checklistId: string }
  | { kind: 'addItem'; checklistId: string; name: string }
  | { kind: 'editItem'; checklistId: string; itemId: string; name?: string; resolved?: boolean }
  | { kind: 'deleteItem'; checklistId: string; itemId: string }

/** Where the next (older) comments page starts: ClickUp's `start` + `start_id` pair. */
export interface CommentCursor {
  start: number
  startId: string
}

export interface CommentPage {
  comments: TaskComment[]
  /** null when there are no older comments. */
  next: CommentCursor | null
}

// ── Browse (Workspace hierarchy) ──────────────────────────────────────────

export interface SpaceRef {
  id: string
  name: string
}

export interface ListRef {
  id: string
  name: string
  /** Task count ClickUp reports, or null. */
  taskCount: number | null
}

export interface FolderRef {
  id: string
  name: string
  lists: ListRef[]
}

/** What expanding a Space shows: its Folders (with their Lists) and its folderless Lists. */
export interface SpaceChildren {
  spaceId: string
  folders: FolderRef[]
  lists: ListRef[]
}

/** One page (100 tasks) of a List, as Browse shows it. */
export interface ListTasksPage {
  listId: string
  page: number
  tasks: TaskSummary[]
  lastPage: boolean
}

export interface Team {
  id: string
  name: string
}

export interface ClickUpUser {
  id: string
  name: string
}

/** How the saved ClickUp credential was obtained. */
export type AuthMethod = 'oauth' | 'personal'

/** The OAuth app the person registered in ClickUp, as the panel may see it (never the secret). */
export interface OAuthAppState {
  /** The app's client id, or null when no app is saved yet. Not a secret. */
  clientId: string | null
  /** The redirect URL the app was registered with (default http://127.0.0.1:47386/callback). */
  redirectUri: string
  /** A sign-in in progress, or null. */
  pending: OAuthPending | null
}

export interface OAuthPending {
  /** The ClickUp page to open in a browser. Carries client id, redirect URL and state, no secret. */
  authorizeUrl: string
  /** Epoch ms when the sign-in stops waiting. */
  expiresAt: number
  /** True when the plugin listens on the loopback redirect URL; false: paste the URL back by hand. */
  listening: boolean
}

/** What the panel needs to decide between the Connect screen and the task list. */
export interface AuthState {
  connected: boolean
  /** How the saved credential was obtained, or null when none is saved. */
  method: AuthMethod | null
  oauth: OAuthAppState
  user: ClickUpUser | null
  teams: Team[]
  /** Selected Workspace (ClickUp calls it "team" in API v2). */
  teamId: string | null
  /** 'unavailable' means the OS has no keyring: secrets cannot be saved. */
  secretProtection: 'os-keyring' | 'unavailable'
}

export interface TaskListResult {
  tasks: TaskSummary[]
  /** True when no List is chosen yet: nothing was fetched, the panel asks the person to choose. */
  scopeEmpty: boolean
  /** Epoch ms of the ClickUp fetch these tasks came from. */
  fetchedAt: number
  /** True when the cache is older than the refresh window; the panel may ask for a refresh. */
  stale: boolean
}

/** A git project in Orca that a task can start in. */
export interface ProjectOption {
  id: string
  name: string
  /** `local`, `ssh:…` or `runtime:…` (a paired Orca server). Passed back to workspace.create. */
  hostId: string
  /** Where the worktree is created, for the Select label ("this computer", "server", "SSH"). */
  hostLabel: string
}

export interface StartOptions {
  projects: ProjectOption[]
  /** Project remembered for this task's List, when still present. */
  suggestedProjectId: string | null
  agents: AgentChoice[]
  /** Workspace (and branch) name the worker will create, e.g. "CU-86c1x2a-migrate-billing-webhooks". */
  workspaceName: string
  /** Status the task moves to on start when the person keeps the box checked; null if none fits. */
  inProgressStatus: string | null
  /** Why that status (or why none): shown under the checkbox so nothing changes silently. */
  inProgressWhy: string
  /** Start form seeds, from the person's settings (Phase 6). */
  defaults: StartDefaults
}

/** What the Start form starts with. `moveToInProgress` is already false when `inProgressStatus` is null. */
export interface StartDefaults {
  agent: string
  moveToInProgress: boolean
  /** '' means the project's default base. */
  baseBranch: string
  /** Task context mode the Select starts with (the setting). */
  taskContext: TaskContextMode
}

/**
 * How much of the task the first prompt carries (docs/TASK-CONTEXT.md). 'link-and-snapshot' (the
 * default) sends the link plus a fenced snapshot; 'snapshot-only' leaves out the instruction to
 * read the link; 'link-only' sends no task text at all, for agents with their own ClickUp access.
 */
export type TaskContextMode = 'link-and-snapshot' | 'link-only' | 'snapshot-only'
export type ResolvedTaskContext = TaskContextMode

/**
 * The plugin's settings (Phase 6). Stored by the worker (PrefsStore); the panel edits them in the
 * Settings tab through 'settings.get' / 'settings.update'.
 */
export interface PluginSettings {
  /** Agent the Start form preselects. One of the worker's AGENTS ids. Default 'claude'. */
  defaultAgent: string
  /** Whether "Move to in progress" starts ticked. Default true. */
  moveToInProgress: boolean
  /** Post a comment on the task (branch, agent) when it is started. Default true. */
  commentOnStart: boolean
  /**
   * When the agent first finishes, move the task to the List's "done" status (review, by type or
   * override) and comment, but only while the task is still in the status the start set. Default true.
   */
  moveOnDone: boolean
  /** Base branch the Start form starts with; '' = the project's default. Trimmed, max 200 chars. Default ''. */
  defaultBaseBranch: string
  /** Show an OS notification when an agent finishes a task's run. Default true. */
  notifyOnDone: boolean
  /** Show an OS notification when an agent run becomes blocked or waiting for input. Default false. */
  notifyOnNeedsInput: boolean
  /** How much of the task the agent gets in its prompt. Default 'link-and-snapshot'. */
  taskContext: TaskContextMode
}

/** 'settings.get' / 'settings.update' answer: the settings plus the agent choices for the Select. */
export interface SettingsState {
  settings: PluginSettings
  agents: { id: string; label: string }[]
}

export interface StartRequest {
  taskId: string
  projectId: string
  /** The project's host, when the same project id exists on more than one host. */
  hostId?: string
  agent: string
  /** Empty or missing: the project's default base. */
  baseBranch?: string
  moveToInProgress: boolean
  /** Overrides the `taskContext` setting for this start. */
  taskContext?: TaskContextMode
}

/** An agent the Start form offers. */
export interface AgentChoice {
  id: string
  label: string
}

/**
 * Agent run state as the plugin tracks it for one linked workspace. 'starting' → … come from Orca's
 * agent events; 'stalled' comes from the plugin's own check (RunWatcher.check, agents.list only):
 * no agent seen, or an agent that never worked, a while after the start. A guess, not proof (setup
 * scripts can be slow, a CLI can be missing). Any later agent event moves the run on again.
 */
export type RunState = 'starting' | 'working' | 'blocked' | 'waiting' | 'done' | 'stalled'
/** Why a run is 'stalled'. */
export interface RunProblem {
  /**
   * no_agent: no agent is running in the workspace (its CLI may be missing, or setup is slow).
   * agent_idle: an agent is open but never started on the task (its prompt may not have arrived).
   */
  kind: 'no_agent' | 'agent_idle'
}

/** What the plugin did to the task's status at start or when the agent finished. */
export interface StatusChange {
  /** The status set, or null when nothing was changed. */
  status: string | null
  /** Why (shown on the run card). */
  note: string
  at: number
}

/** The link between a ClickUp task and the Orca workspace started for it. */
export interface TaskLink {
  taskId: string
  taskName: string
  taskUrl: string
  listId: string
  /** The id workspace.create returned (identity:wt2:…); equals agent events' `workspaceListId`. */
  workspaceId: string
  projectId: string
  branch: string
  agent: string
  createdAt: number
  /** The terminal Orca started the agent in, when Orca said; null for links made before it was kept. */
  terminalId?: string | null
  /** The task-context mode this run's prompt was built with. */
  taskContext?: ResolvedTaskContext
  /** The host the worktree lives on (`local`, `runtime:…`, `ssh:…`). */
  hostId?: string
  /** The status change made at start (null status: none was made). */
  onStart?: StatusChange
  /** The status change made when the agent first finished. */
  onDone?: StatusChange
  run: {
    state: RunState
    /** Epoch ms the current state began. */
    since: number
    /** True once a 'working' state was seen; a 'done' before that is Orca's launch blip. */
    sawWorking: boolean
    /** Set only while state is 'stalled'. */
    problem?: RunProblem
  }
}

export interface UpdateTaskRequest {
  taskId: string
  /** New status name; omit to keep. */
  status?: string
  /** Comment text (plain); omit or empty to post none. */
  comment?: string
}

// ── Lists in scope and status mapping ─────────────────────────────────────

/**
 * Which parts of the Workspace Orca may see. Only tasks whose List falls inside are fetched, shown
 * and ever put into an agent prompt. A Space or Folder entry covers every List in it, including
 * Lists added later. Folders and Lists keep their Space so the panel can group them.
 */
export interface Scope {
  spaces: string[]
  folders: { id: string; spaceId: string }[]
  lists: { id: string; spaceId: string }[]
}

export const EMPTY_SCOPE: Scope = { spaces: [], folders: [], lists: [] }

/** A status move the plugin makes on its own. */
export type StatusTransition = 'start' | 'done'

/** The person's choice for one List and transition: automatic, never change, or a named status. */
export type StatusOverride = { mode: 'auto' } | { mode: 'none' } | { mode: 'status'; name: string }

/** A transition resolved for one List. */
export interface StatusResolution {
  /** The status to move to, or null: leave the task as it is. */
  status: string | null
  source: 'auto' | 'override' | 'none'
  /** Shown to the person: why this status, or why none. */
  why: string
}

/** One List's statuses and what each transition does there (Settings › Lists). */
export interface ListStatusMapping {
  listId: string
  statuses: StatusOption[]
  start: { override: StatusOverride; resolved: StatusResolution }
  done: { override: StatusOverride; resolved: StatusResolution }
}
