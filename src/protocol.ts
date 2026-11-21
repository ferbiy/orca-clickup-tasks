// The panel <-> worker contract, declared once: the panel and the worker both read it.
// Requests are answered by src/worker/handlers.ts; events are posted by the worker's services.
// Every output is a Result envelope (src/shared/errors.ts): Orca would turn a thrown custom error
// code into 'action_failed'. src/panel/api.ts unwraps it.
import type { Result } from './shared/errors'
import type {
  AuthState,
  ChecklistAction,
  CommentCursor,
  CommentInput,
  CommentPage,
  ListTasksPage,
  Person,
  SpaceChildren,
  SpaceRef,
  StatusOption,
  TaskComment,
  TaskDetail,
  TaskListResult,
  TaskPatch,
  UpdateTaskRequest
} from './shared/model'

export {}

declare module 'orca' {
  interface PluginRequests {
    /** Whether a token is saved and verified, its user, Workspaces and the selected one. */
    'auth.state': { output: Result<AuthState> }
    /** Verifies `token` with ClickUp, then saves it to secrets. Selects the Workspace if only one. */
    'auth.connect': { input: { token: string }; output: Result<AuthState> }
    /** Forgets the token, the Workspace choice and the task cache. Links are kept. */
    'auth.disconnect': { output: Result<AuthState> }
    /** Selects the Workspace whose tasks the list shows. */
    'auth.selectTeam': { input: { teamId: string }; output: Result<AuthState> }

    /** My open tasks from cache; `refresh` fetches from ClickUp first. */
    'tasks.list': { input: { refresh?: boolean }; output: Result<TaskListResult> }
    /** One task in full, always fetched from ClickUp. */
    'tasks.get': { input: { taskId: string }; output: Result<TaskDetail> }
    /** The statuses of a List (cached per List). */
    'tasks.statuses': { input: { listId: string }; output: Result<StatusOption[]> }
    /** Changes status and/or posts a comment. Refreshes that task in the cache. */
    'tasks.update': { input: UpdateTaskRequest; output: Result<{ ok: true }> }

    /**
     * Writes the given fields to the task, then answers its fresh TaskDetail (`answerTaskId`
     * answers that task's detail instead, e.g. the parent after a subtask write). With
     * `expectedUpdatedAt` the worker re-fetches first and writes nothing when it differs
     * ('conflict').
     */
    'tasks.patch': {
      input: { taskId: string; patch: TaskPatch; expectedUpdatedAt?: number; answerTaskId?: string }
      output: Result<TaskDetail>
    }
    /** Adds or removes one tag on the task ("add" creates a missing Space tag). Fresh detail. */
    'tasks.tag': { input: { taskId: string; name: string; action: 'add' | 'remove' }; output: Result<TaskDetail> }
    /** One checklist write (create/rename/delete/item). Fresh detail. */
    'tasks.checklist': { input: { taskId: string; action: ChecklistAction }; output: Result<TaskDetail> }
    /** Creates a subtask under this task. Fresh detail of the parent. */
    'tasks.createSubtask': { input: { taskId: string; name: string }; output: Result<TaskDetail> }
    /** Members of the selected Workspace (cached 1 h). */
    'workspace.members': { input: { refresh?: boolean }; output: Result<Person[]> }
    /** Tag names of a Space (cached 1 h, sorted). */
    'tasks.spaceTags': { input: { spaceId: string; refresh?: boolean }; output: Result<string[]> }

    /** Posts a comment on the task (mentions included as rich parts). */
    'comments.create': { input: { taskId: string; comment: CommentInput }; output: Result<{ ok: true }> }
    /** Posts a reply under a comment. */
    'comments.reply': { input: { commentId: string; comment: CommentInput }; output: Result<{ ok: true }> }
    /** Edits a comment's text, assignee or resolved flag. */
    'comments.edit': {
      input: { commentId: string; text?: string; assigneeId?: string | null; resolved?: boolean }
      output: Result<{ ok: true }>
    }
    /** Deletes a comment and its replies. */
    'comments.delete': { input: { commentId: string }; output: Result<{ ok: true }> }

    /** Newest comments of a task, or those older than `before`. Never cached. */
    'tasks.comments': { input: { taskId: string; before?: CommentCursor }; output: Result<CommentPage> }

    /** Threaded replies of one comment, oldest first. Never cached. */
    'tasks.replies': { input: { commentId: string }; output: Result<TaskComment[]> }

    /** Spaces of the selected Workspace (cached 1 h; `refresh` re-fetches). */
    'browse.spaces': { input: { refresh?: boolean }; output: Result<SpaceRef[]> }
    /** Folders and Lists of a Space (cached 1 h; `refresh` re-fetches). */
    'browse.children': { input: { spaceId: string; refresh?: boolean }; output: Result<SpaceChildren> }
    /** One page of a List's tasks, always from ClickUp. */
    'browse.tasks': { input: { listId: string; page: number; includeClosed: boolean }; output: Result<ListTasksPage> }

    /** Drops cached tasks, statuses and the Browse tree (not the token or Workspace choice), then posts 'tasks.changed'. */
    'cache.clear': { output: Result<{ ok: true }> }
  }

  interface PluginPanelEvents {
    /** The task cache changed (refresh, update, edit). The panel re-requests 'tasks.list'. */
    'tasks.changed': { fetchedAt: number }
    /** The token or Workspace changed in another panel run. */
    'auth.changed': AuthState
  }
}
