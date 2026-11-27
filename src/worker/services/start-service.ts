// "Start in worktree": creates the Orca workspace for a task with the agent and its first prompt in
// one workspace.create call (not agent.launch, whose prompt Orca can lose: stablyai/orca#41107),
// records the link, then moves the status and comments (TransitionService).
import { messageOf, PluginError } from '../../shared/errors'
import type { ProjectOption, StartOptions, StartRequest, TaskComment, TaskContextMode, TaskDetail, TaskLink } from '../../shared/model'
import { buildWorkspaceName } from '../../shared/workspace-name'
import type { Clock, OrcaGateway, PanelPoster } from '../ports'
import { buildAgentPrompt } from '../prompt'
import type { PrefsStore } from '../stores/prefs-store'
import type { RunWatcher } from './run-watcher'
import type { TaskService } from './task-service'
import type { TransitionService } from './transition-service'

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

/** Where a project's worktrees are made, for the Select. */
export function hostLabel(hostId: string): string {
  if (hostId === 'local') return 'this computer'
  if (hostId.startsWith('runtime:')) return 'Orca server'
  if (hostId.startsWith('ssh:')) return 'SSH'
  if (hostId.startsWith('wsl:')) return 'WSL'
  return hostId
}

export interface StartServiceDeps {
  tasks: TaskService
  prefs: PrefsStore
  gateway: OrcaGateway
  watcher: RunWatcher
  transitions: TransitionService
  post: PanelPoster
  clock: Clock
  /** A fresh random fence per prompt (crypto.randomUUID in the worker). */
  fence: () => string
}

export class StartService {
  constructor(private readonly deps: StartServiceDeps) {}

  async options(taskId: string): Promise<StartOptions> {
    // The panel opens a task with tasks.get and start.options together: reuse that fetch.
    const task = await this.deps.tasks.get(taskId, { reuse: true })
    const [projects, start, remembered, settings] = await Promise.all([
      this.projects(),
      this.deps.transitions.resolve(task.list.id, 'start'),
      this.deps.prefs.projectForList(task.list.id),
      this.deps.prefs.settings()
    ])
    return {
      projects,
      suggestedProjectId: projects.some((p) => p.id === remembered) ? remembered : null,
      agents: AGENTS.map((a) => ({ ...a })),
      workspaceName: buildWorkspaceName(task),
      inProgressStatus: start.status,
      inProgressWhy: start.why,
      defaults: {
        agent: settings.defaultAgent,
        moveToInProgress: settings.moveToInProgress && start.status !== null,
        baseBranch: settings.defaultBaseBranch,
        taskContext: settings.taskContext
      }
    }
  }

  async run(request: StartRequest): Promise<TaskLink> {
    if (!AGENTS.some((a) => a.id === request.agent)) {
      throw new PluginError('invalid_input', `Unknown agent "${request.agent}".`)
    }
    const project = (await this.projects()).find(
      (p) => p.id === request.projectId && (request.hostId === undefined || p.hostId === request.hostId)
    )
    if (!project) throw new PluginError('not_found', 'That project is no longer in Orca.')
    // Scope is checked here (tasks.get refuses a task of a List that is not chosen).
    const task = await this.deps.tasks.get(request.taskId)
    const name = buildWorkspaceName(task)
    const baseBranch = request.baseBranch?.trim()
    const mode = request.taskContext ?? (await this.deps.prefs.settings()).taskContext
    const prompt = await this.promptFor(task, mode)

    let created: { workspaceId: string; terminalId?: string }
    try {
      created = await this.deps.gateway.createWorkspace({
        projectId: project.id,
        hostId: project.hostId,
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
    let link = await this.deps.watcher.adopt({
      taskId: task.id,
      taskName: task.name,
      taskUrl: task.url,
      listId: task.list.id,
      workspaceId: created.workspaceId,
      projectId: project.id,
      hostId: project.hostId,
      branch,
      agent: request.agent,
      createdAt: now,
      terminalId: created.terminalId ?? null,
      taskContext: mode,
      run: { state: 'starting', since: now, sawWorking: false }
    })
    // Orca sends no event when the agent never starts: look for ourselves a few times.
    this.deps.watcher.watchStart(created.workspaceId)
    await this.deps.prefs.setProjectForList(task.list.id, project.id)
    this.deps.post('link.changed', link)

    // A failed status move or comment is reported on the card, never fatal: the worktree exists.
    const change = await this.deps.transitions.onStart(task, { move: request.moveToInProgress, branch, agent: request.agent })
    link = (await this.deps.watcher.recordStart(created.workspaceId, change)) ?? link
    return link
  }

  /** The task prompt for a run, to paste by hand when the agent did not get it. Same mode as the run. */
  async prompt(workspaceId: string): Promise<string> {
    const link = await this.deps.watcher.linkFor(workspaceId)
    if (!link) throw new PluginError('not_found', 'This run is no longer linked to the task.')
    const task = await this.deps.tasks.get(link.taskId)
    return this.promptFor(task, link.taskContext ?? 'link-and-snapshot')
  }

  /** Fetches the newest comments (a failure only drops them from the snapshot) and builds the prompt. */
  private async promptFor(task: TaskDetail, mode: TaskContextMode): Promise<string> {
    const comments = mode === 'link-only' ? [] : await this.commentsFor(task.id)
    return buildAgentPrompt(task, { fence: this.deps.fence(), mode, comments })
  }

  private async commentsFor(taskId: string): Promise<TaskComment[]> {
    try {
      return (await this.deps.tasks.comments(taskId)).comments
    } catch (error) {
      this.deps.gateway.log(`prompt comments failed: ${messageOf(error)}`)
      return []
    }
  }

  /** Git projects Orca shows, on this computer or a paired server / SSH host. */
  async projects(): Promise<ProjectOption[]> {
    const projects = await this.deps.gateway.listProjects()
    return projects
      .filter((p) => p.kind === 'git' && !p.hidden)
      .map((p) => ({ id: p.id, name: p.name, hostId: p.hostId, hostLabel: p.hostLabel ?? hostLabel(p.hostId) }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.hostLabel.localeCompare(b.hostLabel))
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
}
