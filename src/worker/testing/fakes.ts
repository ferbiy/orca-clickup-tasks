// Test doubles for the worker's ports. Test-only: never imported by production code.
import type { PluginPanelEvents } from 'orca'
import type {
  ChecklistAction, ClickUpUser, CommentCursor, CommentInput, CommentPage, Person, SpaceChildren, SpaceRef, StatusOption, TaskComment, TaskDetail, TaskPatch, TaskSummary, Team
} from '../../shared/model'
import type { TaskTracker } from '../../tracker/tracker'
import type { PanelPoster, SecretStore } from '../ports'

export function taskDetail(overrides: Partial<TaskDetail> = {}): TaskDetail {
  return {
    id: '86c1x2a',
    customId: null,
    name: 'Migrate billing webhooks to v2',
    status: { name: 'to do', type: 'open' },
    priority: 'high',
    dueDate: null,
    url: 'https://app.clickup.com/t/86c1x2a',
    list: { id: 'L1', name: 'Backlog' },
    location: 'API › Backlog',
    parentId: null,
    updatedAt: 1,
    createdAt: null,
    timeEstimateMs: null,
    description: 'Move /webhooks/stripe to thin events.',
    checklists: [],
    subtasks: [],
    tags: [],
    assignees: [],
    watchers: [],
    startDate: null,
    spaceId: 's1',
    timeSpentMs: null,
    attachments: [],
    customFields: [],
    ...overrides
  }
}

export const STATUSES: StatusOption[] = [
  { name: 'to do', type: 'open', order: 0 },
  { name: 'in progress', type: 'custom', order: 1 },
  { name: 'review', type: 'custom', order: 2 },
  { name: 'complete', type: 'closed', order: 3 }
]

/** Records calls; behaviour is set per test through the public fields. */
export class FakeTracker implements TaskTracker {
  calls: { method: string; args: unknown[] }[] = []
  user: ClickUpUser = { id: 'u1', name: 'Linh N.' }
  teams: Team[] = [{ id: 't1', name: 'Acme Engineering' }]
  tasks: TaskSummary[] = [taskDetail()]
  detail: TaskDetail = taskDetail()
  statuses: StatusOption[] = STATUSES
  spaces: SpaceRef[] = [{ id: 's1', name: 'Engineering' }]
  children: SpaceChildren = {
    spaceId: 's1',
    folders: [{ id: 'f1', name: 'API', lists: [{ id: 'L1', name: 'Backlog', taskCount: 3 }] }],
    lists: [{ id: 'L2', name: 'Inbox', taskCount: null }]
  }
  listPages: { tasks: TaskSummary[]; lastPage: boolean }[] = [{ tasks: [taskDetail()], lastPage: true }]
  comments: CommentPage = { comments: [], next: null }
  replies: TaskComment[] = []
  members: Person[] = [{ id: 'u1', name: 'Linh N.', initials: 'LN' }]
  spaceTags: string[] = ['backend', 'billing']
  nextSubtaskId = 'sub1'
  fail: Partial<Record<keyof TaskTracker, Error>> = {}

  private record(method: keyof TaskTracker, args: unknown[]): void {
    this.calls.push({ method, args })
    const error = this.fail[method]
    if (error) throw error
  }
  count(method: keyof TaskTracker): number {
    return this.calls.filter((c) => c.method === method).length
  }

  async verify() { this.record('verify', []); return this.user }
  async listTeams() { this.record('listTeams', []); return this.teams }
  async listMyTasks(teamId: string, userId: string) { this.record('listMyTasks', [teamId, userId]); return this.tasks }
  async getTask(taskId: string) { this.record('getTask', [taskId]); return this.detail }
  async listStatuses(listId: string) { this.record('listStatuses', [listId]); return this.statuses }
  async setStatus(taskId: string, status: string) { this.record('setStatus', [taskId, status]) }
  async updateTask(taskId: string, patch: TaskPatch) { this.record('updateTask', [taskId, patch]) }
  async addTag(taskId: string, name: string) { this.record('addTag', [taskId, name]) }
  async removeTag(taskId: string, name: string) { this.record('removeTag', [taskId, name]) }
  async listSpaceTags(spaceId: string) { this.record('listSpaceTags', [spaceId]); return this.spaceTags }
  async listMembers(teamId: string) { this.record('listMembers', [teamId]); return this.members }
  async checklist(taskId: string, action: ChecklistAction) { this.record('checklist', [taskId, action]) }
  async createSubtask(listId: string, parentId: string, name: string) {
    this.record('createSubtask', [listId, parentId, name])
    return this.nextSubtaskId
  }
  async addComment(taskId: string, comment: CommentInput) { this.record('addComment', [taskId, comment]) }
  async replyComment(commentId: string, comment: CommentInput) { this.record('replyComment', [commentId, comment]) }
  async editComment(commentId: string, edit: { text?: string; assigneeId?: string | null; resolved?: boolean }) {
    this.record('editComment', [commentId, edit])
  }
  async deleteComment(commentId: string) { this.record('deleteComment', [commentId]) }
  async listSpaces(teamId: string) { this.record('listSpaces', [teamId]); return this.spaces }
  async listSpaceChildren(spaceId: string) { this.record('listSpaceChildren', [spaceId]); return { ...this.children, spaceId } }
  async listTasksInList(listId: string, options: { page: number; includeClosed: boolean }) {
    this.record('listTasksInList', [listId, options])
    return this.listPages[options.page] ?? { tasks: [], lastPage: true }
  }
  async listComments(taskId: string, before?: CommentCursor) { this.record('listComments', [taskId, before]); return this.comments }
  async listReplies(commentId: string) { this.record('listReplies', [commentId]); return this.replies }
}

export interface Posted { event: keyof PluginPanelEvents; payload: unknown }

export function recordingPoster(): { post: PanelPoster; posts: Posted[] } {
  const posts: Posted[] = []
  return { posts, post: (event, payload) => { posts.push({ event, payload }) } }
}

export class MemorySecrets implements SecretStore {
  values = new Map<string, string>()
  protectionValue: 'os-keyring' | 'unavailable' = 'os-keyring'
  async get(key: string) { return this.values.get(key) ?? null }
  async set(key: string, value: string) { this.values.set(key, value) }
  async delete(key: string) { this.values.delete(key) }
  async protection() { return this.protectionValue }
}

/** A clock tests move by hand. */
export function manualClock(start = 1_795_186_000_000): { now: () => number; advance: (ms: number) => void } {
  let t = start
  return { now: () => t, advance: (ms) => { t += ms } }
}
