// "Start in worktree": creates the Orca workspace for a task, briefs the agent, records the link.
import { PluginError } from '../../shared/errors'
import type {
  ResolvedTaskContext,
  RetryRequest,
  StartOptions,
  StartRequest,
  TaskComment,
  TaskContextMode,
  TaskDetail,
  TaskLink
} from '../../shared/model'
import { pickInProgressStatus } from '../../shared/status-pick'
import { resolveMode } from '../../shared/task-context'
import { buildWorkspaceName } from '../../shared/workspace-name'
import type { Clock, OrcaGateway, PanelPoster } from '../ports'
import { buildAgentPrompt } from '../prompt'
import { deliverPrompt, type DeliveryFailure } from './prompt-delivery'
import type { PrefsStore } from '../stores/prefs-store'
import type { RunWatcher } from './run-watcher'
import type { TaskService } from './task-service'

/** Agents offered in the Start form. Ids are what workspace.create's `agent` takes. */
export const AGENTS: readonly { id: string; label: string }[] = [
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'copilot', label: 'Copilot' }
]

export function agentLabel(id: string): string {
  return AGENTS.find((a) => a.id === id)?.label ?? id
}

export interface StartServiceDeps {
  tasks: TaskService
  prefs: PrefsStore
  gateway: OrcaGateway
  watcher: RunWatcher
  post: PanelPoster
  clock: Clock
  /** A fresh random fence per prompt (crypto.randomUUID in the worker). */
  fence: () => string
  /** Waits (setTimeout in the worker); tests pass one that returns at once. */
  sleep: (ms: number) => Promise<void>
}

/** How long a retried agent gets to show up in agents.list before its prompt is given up on. */
const RETRY_READY_MS = 45_000
/** An agent already sitting idle is listed now; only a short wait. */
const IDLE_READY_MS = 5_000

export class StartService {
  constructor(private readonly deps: StartServiceDeps) {}

  async options(taskId: string): Promise<StartOptions> {
    // The panel opens a task with tasks.get and start.options together: reuse that fetch.
    const task = await this.deps.tasks.get(taskId, { reuse: true })
    const [projects, statuses, remembered, settings, missing, clickUp] = await Promise.all([
      this.gitProjects(),
      this.deps.tasks.statuses(task.list.id),
      this.deps.prefs.projectForList(task.list.id),
      this.deps.prefs.settings(),
      this.deps.prefs.missingAgents(),
      this.deps.prefs.agentClickUpAll()
    ])
    const inProgressStatus = pickInProgressStatus(statuses)
    return {
      projects,
      suggestedProjectId: projects.some((p) => p.id === remembered) ? remembered : null,
      agents: AGENTS.map((a) => ({
        ...a,
        ...(missing.includes(a.id) ? { missing: true } : {}),
        ...(clickUp[a.id] ? { clickUp: clickUp[a.id] } : {})
      })),
      workspaceName: buildWorkspaceName(task),
      inProgressStatus,
      defaults: {
        agent: settings.defaultAgent,
        moveToInProgress: settings.moveToInProgress && inProgressStatus !== null,
        baseBranch: settings.defaultBaseBranch,
        taskContext: settings.taskContext
      }
    }
  }

  async run(request: StartRequest): Promise<TaskLink> {
    if (!AGENTS.some((a) => a.id === request.agent)) {
      throw new PluginError('invalid_input', `Unknown agent "${request.agent}".`)
    }
    const projects = await this.gitProjects()
    if (!projects.some((p) => p.id === request.projectId)) {
      throw new PluginError('not_found', 'That project is no longer in Orca.')
    }
    const task = await this.deps.tasks.get(request.taskId)
    const name = buildWorkspaceName(task)
    const baseBranch = request.baseBranch?.trim()
    const { prompt, mode } = await this.promptFor(task, request.agent, request.taskContext)

    let created: { workspaceId: string; terminalId?: string }
    try {
      created = await this.deps.gateway.createWorkspace({
        projectId: request.projectId,
        name,
        ...(baseBranch ? { baseBranch } : {}),
        agent: request.agent,
        prompt
      })
    } catch (error) {
      throw new PluginError('orca_failed', `Orca could not create the workspace: ${messageOf(error)}`)
    }

    // The workspace exists from here on. Read Orca's real branch first, then hand the link to the
    // watcher, which stores it and replays early agent events in one step (no lost updates).
    const branch = (await this.readBranch(created.workspaceId)) ?? name
    const now = this.deps.clock()
    const final = await this.deps.watcher.adopt({
      taskId: task.id,
      taskName: task.name,
      taskUrl: task.url,
      listId: task.list.id,
      workspaceId: created.workspaceId,
      projectId: request.projectId,
      branch,
      agent: request.agent,
      createdAt: now,
      terminalId: created.terminalId ?? null,
      taskContext: mode,
      run: { state: 'starting', since: now, sawWorking: false }
    })
    // Orca sends no event when the agent never starts: look for ourselves a few times.
    this.deps.watcher.watchStart(created.workspaceId)

    await this.deps.prefs.setProjectForList(task.list.id, request.projectId)
    this.deps.post('link.changed', final)

    if (request.moveToInProgress) await this.moveToInProgress(task.id, task.list.id)
    return final
  }

  /**
   * Starts an agent again in a run's existing worktree (same branch), with a freshly built prompt:
   * the one before was never delivered when the agent failed to start.
   */
  async retry(request: RetryRequest): Promise<TaskLink> {
    if (!AGENTS.some((a) => a.id === request.agent)) {
      throw new PluginError('invalid_input', `Unknown agent "${request.agent}".`)
    }
    const link = await this.deps.watcher.linkFor(request.workspaceId)
    if (!link) throw new PluginError('not_found', 'This run is no longer linked to the task.')
    const task = await this.deps.tasks.get(link.taskId)
    const { prompt, mode } = await this.promptFor(task, request.agent, request.taskContext)
    const relaunched = await this.deps.watcher.relaunch(request.workspaceId, request.agent, async () => {
      try {
        return await this.deps.gateway.launchAgent({ workspaceId: request.workspaceId, agent: request.agent })
      } catch (error) {
        throw new PluginError('orca_failed', `Orca could not start ${agentLabel(request.agent)}: ${messageOf(error)}`)
      }
    })
    // In the background: the agent takes seconds to be ready. If this fails, the run check turns the
    // run 'agent_idle' and the card offers "Send the task prompt".
    if (relaunched.terminalId) {
      this.lastDelivery = this.deliver(relaunched.workspaceId, relaunched.terminalId, prompt, mode, RETRY_READY_MS).then((failure) => {
        if (failure) this.deps.gateway.log(`retry prompt not delivered: ${failure}`)
        return failure
      })
    }
    return relaunched
  }

  /** The background delivery a retry started (tests await it). */
  lastDelivery: Promise<DeliveryFailure | null> = Promise.resolve(null)

  /**
   * Types the task prompt into a run's idle agent (the card's "Send the task prompt", or "Send the
   * task details" with `taskContext: 'snapshot-only'` when the agent reported no ClickUp access).
   * Orca switches to the workspace first: it only accepts input for the focused worktree.
   */
  async sendPrompt(workspaceId: string, taskContext?: TaskContextMode): Promise<TaskLink> {
    const link = await this.deps.watcher.linkFor(workspaceId)
    if (!link) throw new PluginError('not_found', 'This run is no longer linked to the task.')
    if (!link.terminalId) throw new PluginError('not_found', 'The agent terminal of this run is not known. Retry instead.')
    const task = await this.deps.tasks.get(link.taskId)
    const { prompt, mode } = await this.promptFor(task, link.agent, taskContext ?? link.taskContext)
    const failure = await this.deliver(workspaceId, link.terminalId, prompt, mode, IDLE_READY_MS)
    if (failure === 'agent_not_ready') throw new PluginError('orca_failed', 'No agent is running in that terminal any more. Retry instead.')
    if (failure) throw new PluginError('orca_failed', 'Orca did not take the prompt. Open the workspace and paste it from "Task prompt".')
    return (await this.deps.watcher.linkFor(workspaceId)) ?? link
  }

  private async deliver(
    workspaceId: string,
    terminalId: string,
    prompt: string,
    mode: ResolvedTaskContext,
    readyTimeoutMs: number
  ): Promise<DeliveryFailure | null> {
    const failure = await deliverPrompt(
      { gateway: this.deps.gateway, sleep: this.deps.sleep },
      { workspaceId, terminalId, prompt },
      { readyTimeoutMs }
    )
    if (!failure) {
      await this.deps.watcher.promptSent(workspaceId)
      await this.deps.watcher.contextSent(workspaceId, mode)
    }
    return failure
  }

  /** The task prompt for a run, built in the mode the run used, to paste when the agent did not get it. */
  async prompt(workspaceId: string): Promise<string> {
    const link = await this.deps.watcher.linkFor(workspaceId)
    if (!link) throw new PluginError('not_found', 'This run is no longer linked to the task.')
    const task = await this.deps.tasks.get(link.taskId)
    return (await this.promptFor(task, link.agent, link.taskContext)).prompt
  }

  /**
   * The one prompt builder every entry point shares (§6): fetches the newest comments (a failure is
   * logged and the snapshot just omits them), resolves the mode from the override or the setting
   * and the agent's learned ClickUp access, and builds the prompt.
   */
  private async promptFor(
    task: TaskDetail,
    agent: string,
    override?: TaskContextMode
  ): Promise<{ prompt: string; mode: ResolvedTaskContext }> {
    const [comments, settings, learned] = await Promise.all([
      this.commentsFor(task.id),
      this.deps.prefs.settings(),
      this.deps.prefs.agentClickUp(agent)
    ])
    const mode = resolveMode(override ?? settings.taskContext, learned)
    return { prompt: buildAgentPrompt(task, { fence: this.deps.fence(), mode, comments }), mode }
  }

  private async commentsFor(taskId: string): Promise<TaskComment[]> {
    try {
      return (await this.deps.tasks.comments(taskId)).comments
    } catch (error) {
      this.deps.gateway.log(`prompt comments failed: ${messageOf(error)}`)
      return []
    }
  }

  async open(workspaceId: string): Promise<void> {
    try {
      await this.deps.gateway.openWorkspace(workspaceId)
    } catch (error) {
      throw new PluginError('orca_failed', `Orca could not open the workspace: ${messageOf(error)}`)
    }
  }

  private async gitProjects() {
    const projects = await this.deps.gateway.listProjects()
    // v0.1: local git projects only; SSH/remote hosts and folders are out of scope.
    return projects
      .filter((p) => p.kind === 'git' && !p.hidden && p.hostId === 'local')
      .map((p) => ({ id: p.id, name: p.name, hostId: p.hostId }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  /** Orca derives the branch from the name; read the real one back. Best effort. */
  private async readBranch(workspaceId: string): Promise<string | null> {
    try {
      const workspaces = await this.deps.gateway.listWorkspaces()
      return workspaces.find((w) => w.id === workspaceId)?.branch || null
    } catch (error) {
      this.deps.gateway.log(`branch read-back failed: ${messageOf(error)}`)
      return null
    }
  }

  /** A failed status move is logged, never fatal: the worktree and agent already exist. */
  private async moveToInProgress(taskId: string, listId: string): Promise<void> {
    try {
      const status = pickInProgressStatus(await this.deps.tasks.statuses(listId))
      if (status) await this.deps.tasks.update({ taskId, status })
    } catch (error) {
      this.deps.gateway.log(`move to in progress failed: ${messageOf(error)}`)
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
