// Every panel write to a task or its comments (Phase 8a/8b). Task writes answer the fresh
// TaskDetail so the panel can swap it in; comment writes answer nothing but ok.
import { PluginError } from '../../shared/errors'
import type {
  ChecklistAction,
  CommentInput,
  Person,
  TaskDetail,
  TaskPatch
} from '../../shared/model'
import type { Clock, PanelPoster } from '../ports'
import type { CacheStore } from '../stores/cache-store'
import type { AuthService } from './auth-service'
import type { TaskService } from './task-service'

export interface EditServiceDeps {
  auth: AuthService
  tasks: TaskService
  cache: CacheStore
  post: PanelPoster
  clock: Clock
  /** Members and Space tags are re-fetched after this long. Default 1 hour. */
  pickerMaxAgeMs?: number
}

export class EditService {
  private readonly pickerMaxAgeMs: number

  constructor(private readonly deps: EditServiceDeps) {
    this.pickerMaxAgeMs = deps.pickerMaxAgeMs ?? 60 * 60_000
  }

  /** Re-fetches the task (fresh cache row), tells the panels, and answers the detail. */
  private async refreshed(taskId: string): Promise<TaskDetail> {
    const task = await this.deps.tasks.get(taskId)
    this.deps.post('tasks.changed', { fetchedAt: this.deps.clock() })
    return task
  }

  /** The task a write answers: `answerTaskId` when given (a subtask write reads the parent). */
  private async answer(taskId: string, answerTaskId?: string): Promise<TaskDetail> {
    const task = await this.refreshed(taskId)
    return answerTaskId !== undefined && answerTaskId !== taskId ? this.deps.tasks.get(answerTaskId) : task
  }

  /**
   * Writes the patch. With `expectedUpdatedAt` the task is fetched first and a different
   * updatedAt means someone else changed it: 'conflict' and nothing is written.
   */
  async patch(
    taskId: string,
    patch: TaskPatch,
    options: { expectedUpdatedAt?: number; answerTaskId?: string } = {}
  ): Promise<TaskDetail> {
    const tracker = await this.deps.auth.tracker()
    if (options.expectedUpdatedAt !== undefined) {
      const current = await this.deps.tasks.get(taskId)
      if (current.updatedAt !== options.expectedUpdatedAt) {
        throw new PluginError('conflict', 'This task changed in ClickUp. It was reloaded; your text is kept.')
      }
    }
    await tracker.updateTask(taskId, patch)
    return this.answer(taskId, options.answerTaskId)
  }

  async tag(taskId: string, name: string, action: 'add' | 'remove'): Promise<TaskDetail> {
    const tracker = await this.deps.auth.tracker()
    if (action === 'add') await tracker.addTag(taskId, name)
    else await tracker.removeTag(taskId, name)
    return this.refreshed(taskId)
  }

  async checklist(taskId: string, action: ChecklistAction): Promise<TaskDetail> {
    const tracker = await this.deps.auth.tracker()
    await tracker.checklist(taskId, action)
    return this.refreshed(taskId)
  }

  /** Creates a subtask in the parent's List (the subtask entry carries no list id). */
  async createSubtask(taskId: string, name: string): Promise<TaskDetail> {
    const tracker = await this.deps.auth.tracker()
    const parent = await this.deps.tasks.get(taskId)
    if (!parent.list.id) throw new PluginError('invalid_input', 'This task has no List to hold a subtask.')
    await tracker.createSubtask(parent.list.id, taskId, name)
    return this.refreshed(taskId)
  }

  /** Members of the selected Workspace, cached for the picker window. */
  async members(refresh: boolean): Promise<Person[]> {
    const { tracker, teamId } = await this.deps.auth.session()
    const now = this.deps.clock()
    if (!refresh) {
      const cached = await this.deps.cache.readMembers(teamId, now, this.pickerMaxAgeMs)
      if (cached) return cached
    }
    const members = await tracker.listMembers(teamId)
    await this.deps.cache.writeMembers(teamId, now, members)
    return members
  }

  /** Tag names of a Space, cached for the picker window. */
  async spaceTags(spaceId: string, refresh: boolean): Promise<string[]> {
    const tracker = await this.deps.auth.tracker()
    const now = this.deps.clock()
    if (!refresh) {
      const cached = await this.deps.cache.readSpaceTags(spaceId, now, this.pickerMaxAgeMs)
      if (cached) return cached
    }
    const tags = await tracker.listSpaceTags(spaceId)
    await this.deps.cache.writeSpaceTags(spaceId, now, tags)
    return tags
  }

  async addComment(taskId: string, comment: CommentInput): Promise<{ ok: true }> {
    const tracker = await this.deps.auth.tracker()
    await tracker.addComment(taskId, comment)
    return { ok: true as const }
  }

  async replyComment(commentId: string, comment: CommentInput): Promise<{ ok: true }> {
    const tracker = await this.deps.auth.tracker()
    await tracker.replyComment(commentId, comment)
    return { ok: true as const }
  }

  async editComment(
    commentId: string,
    edit: { text?: string; assigneeId?: string | null; resolved?: boolean }
  ): Promise<{ ok: true }> {
    const tracker = await this.deps.auth.tracker()
    await tracker.editComment(commentId, edit)
    return { ok: true as const }
  }

  async deleteComment(commentId: string): Promise<{ ok: true }> {
    const tracker = await this.deps.auth.tracker()
    await tracker.deleteComment(commentId)
    return { ok: true as const }
  }
}
