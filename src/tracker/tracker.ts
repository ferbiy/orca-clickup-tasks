// The port between the worker's services and a task tracker. ClickUp is the only adapter
// (src/clickup/); services depend on this interface, never on ClickUp DTOs or fetch.
// Worker-only. Every method throws PluginError (src/shared/errors.ts) on failure.
import type {
  ChecklistAction,
  ClickUpUser,
  CommentCursor,
  CommentInput,
  CommentPage,
  Person,
  SpaceChildren,
  SpaceRef,
  StatusOption,
  TaskComment,
  TaskDetail,
  TaskPatch,
  TaskSummary,
  Team
} from '../shared/model'

/** List ids one Workspace task query may carry (ClickUp ORs them); callers chunk by it. */
export const LIST_IDS_PER_REQUEST = 40

export interface TaskTracker {
  /** Checks the token and returns its user. Throws 'auth_invalid' when refused. */
  verify(): Promise<ClickUpUser>
  /** Workspaces (ClickUp "teams") the token can see. */
  listTeams(): Promise<Team[]>
  /**
   * Open tasks assigned to `userId` in `teamId` whose List is one of `listIds`, subtasks included,
   * every page up to `maxPages` (100 tasks a page) per chunk of ids. No ids: no request, no tasks.
   */
  listMyTasks(teamId: string, userId: string, options: { listIds: readonly string[]; maxPages?: number }): Promise<TaskSummary[]>
  /**
   * One page (100 tasks) of the Workspace's tasks in `listIds` (at most 40 ids; never empty),
   * subtasks included, optionally only those assigned to `assigneeId` or in one of `statuses`.
   * Closed tasks only with `includeClosed` (ClickUp also returns them when a closed status is asked).
   */
  queryTasks(
    teamId: string,
    options: { listIds: readonly string[]; assigneeId?: string; includeClosed: boolean; statuses?: readonly string[]; page: number }
  ): Promise<{ tasks: TaskSummary[]; lastPage: boolean }>
  /** One task with its markdown description, checklists, subtasks, assignees and attachments. */
  getTask(taskId: string): Promise<TaskDetail>
  /** Spaces of a Workspace the token can see (archived ones excluded). */
  listSpaces(teamId: string): Promise<SpaceRef[]>
  /** A Space's Folders (each with its Lists) and folderless Lists. Hidden/archived ones excluded. */
  listSpaceChildren(spaceId: string): Promise<SpaceChildren>
  /** One page (100 tasks) of a List, subtasks included; open tasks only unless `includeClosed`. */
  listTasksInList(listId: string, options: { page: number; includeClosed: boolean }): Promise<{ tasks: TaskSummary[]; lastPage: boolean }>
  /** Newest 25 comments, or the 25 older than `before`. */
  listComments(taskId: string, before?: CommentCursor): Promise<CommentPage>
  /** Threaded replies of one comment, oldest first (the parent is not included). */
  listReplies(commentId: string): Promise<TaskComment[]>
  /** The statuses of a List, ordered by `order`. */
  listStatuses(listId: string): Promise<StatusOption[]>
  setStatus(taskId: string, status: string): Promise<void>

  /** Writes the given fields of a task (PUT /task/{id}); only the patch's keys are sent. */
  updateTask(taskId: string, patch: TaskPatch): Promise<void>
  /** Adds a tag to the task, creating the Space tag when it does not exist. */
  addTag(taskId: string, name: string): Promise<void>
  removeTag(taskId: string, name: string): Promise<void>
  /** Tag names of a Space, sorted. */
  listSpaceTags(spaceId: string): Promise<string[]>
  /** Members of a Workspace (team). */
  listMembers(teamId: string): Promise<Person[]>
  /** One checklist write on the task. */
  checklist(taskId: string, action: ChecklistAction): Promise<void>
  /** Creates a subtask of `parentId` in `listId`; answers the new task's id. */
  createSubtask(listId: string, parentId: string, name: string): Promise<string>

  addComment(taskId: string, comment: CommentInput): Promise<void>
  replyComment(commentId: string, comment: CommentInput): Promise<void>
  editComment(
    commentId: string,
    edit: { text?: string; assigneeId?: string | null; resolved?: boolean }
  ): Promise<void>
  deleteComment(commentId: string): Promise<void>
}

/** Builds a tracker for one Authorization header value. The worker makes a new one when it changes. */
export type TaskTrackerFactory = (authorization: string) => TaskTracker
