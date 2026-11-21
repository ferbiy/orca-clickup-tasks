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

/** Full task, fetched on demand for the detail view. */
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
  /** Simple custom fields with a value, shown in the detail view. Untrusted text. */
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

/** What the panel needs to decide between the Connect screen and the task list. */
export interface AuthState {
  connected: boolean
  user: ClickUpUser | null
  teams: Team[]
  /** Selected Workspace (ClickUp calls it "team" in API v2). */
  teamId: string | null
  /** 'unavailable' means the OS has no keyring: secrets cannot be saved. */
  secretProtection: 'os-keyring' | 'unavailable'
}

export interface TaskListResult {
  tasks: TaskSummary[]
  /** Epoch ms of the ClickUp fetch these tasks came from. */
  fetchedAt: number
  /** True when the cache is older than the refresh window; the panel may ask for a refresh. */
  stale: boolean
}

export interface UpdateTaskRequest {
  taskId: string
  /** New status name; omit to keep. */
  status?: string
  /** Comment text (plain); omit or empty to post none. */
  comment?: string
}
