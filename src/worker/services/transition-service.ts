// The status moves the plugin makes on its own: "started" when a task is started in Orca, and
// "done" (review) the first time its agent finishes. Each List resolves them from its statuses'
// types or the person's override (shared/status-pick.ts). Nothing changes silently: every outcome,
// a move or the reason for none, is returned as a StatusChange that the run card shows.
import { messageOf } from '../../shared/errors'
import type {
  ListStatusMapping,
  StatusChange,
  StatusOverride,
  StatusResolution,
  StatusTransition,
  TaskDetail,
  TaskLink
} from '../../shared/model'
import { resolveStatus } from '../../shared/status-pick'
import type { Clock } from '../ports'
import type { PrefsStore } from '../stores/prefs-store'
import type { TaskService } from './task-service'

export interface TransitionServiceDeps {
  tasks: Pick<TaskService, 'statuses' | 'get' | 'update'>
  prefs: PrefsStore
  clock: Clock
  log: (message: string) => void
  agentLabel: (agent: string) => string
}

export class TransitionService {
  constructor(private readonly deps: TransitionServiceDeps) {}

  async resolve(listId: string, which: StatusTransition): Promise<StatusResolution> {
    const [statuses, override] = await Promise.all([this.deps.tasks.statuses(listId), this.deps.prefs.statusOverride(listId, which)])
    return resolveStatus(statuses, which, override)
  }

  async mapping(listId: string): Promise<ListStatusMapping> {
    const [statuses, start, done] = await Promise.all([
      this.deps.tasks.statuses(listId),
      this.deps.prefs.statusOverride(listId, 'start'),
      this.deps.prefs.statusOverride(listId, 'done')
    ])
    return {
      listId,
      statuses,
      start: { override: start, resolved: resolveStatus(statuses, 'start', start) },
      done: { override: done, resolved: resolveStatus(statuses, 'done', done) }
    }
  }

  async setOverride(listId: string, which: StatusTransition, override: StatusOverride): Promise<ListStatusMapping> {
    await this.deps.prefs.setStatusOverride(listId, which, override)
    return this.mapping(listId)
  }

  /** On start: move to the "started" status when asked and one fits, and comment when the setting says so. */
  async onStart(task: TaskDetail, input: { move: boolean; branch: string; agent: string }): Promise<StatusChange> {
    const settings = await this.deps.prefs.settings()
    let status: string | null = null
    let note: string
    try {
      if (input.move) {
        const r = await this.resolve(task.list.id, 'start')
        if (r.status === null) note = r.why
        else if (r.status === task.status.name) note = `Already “${r.status}”.`
        else {
          status = r.status
          note = `Moved to “${r.status}”.`
        }
      } else {
        note = 'Status left as it is (not asked to move it).'
      }
      const comment = settings.commentOnStart
        ? `Started in Orca: ${this.deps.agentLabel(input.agent)} is working on branch ${input.branch}.`
        : ''
      if (status || comment) await this.deps.tasks.update({ taskId: task.id, ...(status ? { status } : {}), comment })
      if (comment) note += ' Comment posted.'
    } catch (error) {
      this.deps.log(`start transition failed: ${messageOf(error)}`)
      return { status: null, note: `Could not update ClickUp: ${messageOf(error)}`, at: this.deps.clock() }
    }
    return { status, note, at: this.deps.clock() }
  }

  /**
   * The agent finished for the first time: move to the List's "done" status, but only while the
   * task still shows the status the start set (or, when the start set none, any open or custom
   * status), so a person's change in ClickUp is never overwritten. Null when the setting is off.
   */
  async onFirstFinish(link: TaskLink): Promise<StatusChange | null> {
    const settings = await this.deps.prefs.settings()
    if (!settings.moveOnDone) return null
    const at = this.deps.clock()
    try {
      const task = await this.deps.tasks.get(link.taskId)
      const r = await this.resolve(task.list.id, 'done')
      if (r.status === null) return { status: null, note: r.why, at }
      const current = task.status.name
      if (current.toLowerCase() === r.status.toLowerCase()) return { status: null, note: `Already “${current}”.`, at }
      const expected = link.onStart?.status ?? null
      if (expected ? current.toLowerCase() !== expected.toLowerCase() : task.status.type === 'done' || task.status.type === 'closed') {
        return { status: null, note: `Left as “${current}”: it was changed in ClickUp after the start.`, at }
      }
      const comment = settings.commentOnStart
        ? `${this.deps.agentLabel(link.agent)} finished on branch ${link.branch}. Review the changes in Orca.`
        : ''
      await this.deps.tasks.update({ taskId: task.id, status: r.status, comment })
      return { status: r.status, note: `Moved to “${r.status}”.${comment ? ' Comment posted.' : ''}`, at }
    } catch (error) {
      this.deps.log(`done transition failed: ${messageOf(error)}`)
      return { status: null, note: `Could not update ClickUp: ${messageOf(error)}`, at }
    }
  }
}
