// Turns Orca's agent status events into per-task run state, notifies once per finished run, and
// hands the first finish to the status transition. Facts it relies on (spike, 2026-11-20): events
// name the workspace by `workspaceListId` (the id workspace.create returned), and Orca emits a
// 'done' blip at launch before the agent works. Orca sends nothing when the agent never starts, so
// `check` also looks for itself, with agents.list only: this plugin never reads or types into
// terminals (no terminal:read, no terminal:send).
import type { PluginSettings, RunProblem, RunState, TaskLink } from '../../shared/model'
import type { Clock, OrcaGateway, PanelPoster } from '../ports'
import type { LinkStore } from '../stores/link-store'

export interface AgentStatusEvent {
  workspaceListId?: string
  state: 'working' | 'blocked' | 'waiting' | 'done'
  mainAgent?: { state: 'working' | 'blocked' | 'waiting' | 'done' }
}

export interface WorkspaceRemovedEvent {
  workspaceId: string
  workspaceListId?: string
}

export interface RunWatcherDeps {
  links: LinkStore
  gateway: OrcaGateway
  post: PanelPoster
  clock: Clock
  /** Display name for an agent id ("claude" → "Claude"). */
  agentLabel: (agent: string) => string
  /** Read at notify time, so a changed setting applies to the next event. */
  settings: () => Promise<PluginSettings>
  /**
   * The run finished for the first time (into 'done' after working). Answers what to store on the
   * link (the status change made, or why none), or null to leave it. Runs inside the queue.
   */
  onFirstFinish?: (link: TaskLink) => Promise<TaskLink['onDone'] | null>
  /** Runs `work` after `ms` (setTimeout in the worker). Without it, only explicit checks run. */
  schedule?: (work: () => void, ms: number) => void
}

/** A run with no working agent this long after it began is 'stalled'. Setup scripts run first, so it is a guess. */
export const STALL_MS = 60_000
/** When a new run is checked on its own: soon, then while it may be slow. */
const CHECK_AFTER_MS: readonly number[] = [STALL_MS + 5_000, 180_000, 600_000]

/** Events for workspaces not linked yet are kept briefly: the agent can report before start.run
 *  has stored the link. */
const BUFFER_MS = 120_000
const BUFFER_MAX = 50

export class RunWatcher {
  /** Serializes read-modify-write on links: Orca sends bursts (done, done, working) within ms. */
  private queue: Promise<void> = Promise.resolve()
  private readonly pending = new Map<string, { at: number; events: AgentStatusEvent[] }>()

  constructor(private readonly deps: RunWatcherDeps) {}

  onAgentStatus(event: AgentStatusEvent): Promise<void> {
    return this.enqueue(() => this.apply(event))
  }

  onWorkspaceRemoved(event: WorkspaceRemovedEvent): Promise<void> {
    return this.enqueue(async () => {
      const id = event.workspaceListId ?? event.workspaceId
      this.pending.delete(id)
      const removed = await this.deps.links.remove(id)
      if (removed) this.deps.post('link.removed', { workspaceId: id })
    })
  }

  /**
   * Registers a new link and replays events that arrived before it, in one queued step, so no
   * event can slip between the write and the replay. From here on RunWatcher is the link's only
   * writer. Resolves with the link as stored after the replay.
   */
  adopt(link: TaskLink): Promise<TaskLink> {
    let stored: TaskLink = link
    return this.enqueue(async () => {
      await this.deps.links.put(link)
      const buffered = this.pending.get(link.workspaceId)
      this.pending.delete(link.workspaceId)
      for (const event of buffered?.events ?? []) await this.apply(event)
      stored = (await this.deps.links.get(link.workspaceId)) ?? link
    }).then(() => stored)
  }

  /**
   * Looks at the workspace itself, for runs Orca's events left behind: syncs a missed state from
   * agents.list, else marks the run 'stalled'. Resolves with the link as stored after, or null.
   */
  check(workspaceId: string): Promise<TaskLink | null> {
    const out: { link: TaskLink | null } = { link: null }
    return this.enqueue(async () => {
      out.link = await this.checkOne(workspaceId)
    }).then(() => out.link)
  }

  /** Checks every run that is not done. Called when the worker starts and on the panel's Refresh. */
  async checkAll(): Promise<TaskLink[]> {
    for (const link of await this.deps.links.list()) {
      if (link.run.state !== 'done') await this.check(link.workspaceId)
    }
    return this.deps.links.list()
  }

  /** Checks a new run a few times on its own, until it is no longer 'starting' or 'stalled'. */
  watchStart(workspaceId: string): void {
    const schedule = this.deps.schedule
    if (!schedule) return
    for (const ms of CHECK_AFTER_MS) {
      schedule(() => {
        void this.deps.links
          .get(workspaceId)
          .then((link) => {
            if (link && (link.run.state === 'starting' || link.run.state === 'stalled')) return this.check(workspaceId)
            return null
          })
          .catch((error: unknown) => this.deps.gateway.log(`run check failed: ${String(error)}`))
      }, ms)
    }
  }

  /** The stored link for a workspace, or null. */
  linkFor(workspaceId: string): Promise<TaskLink | null> {
    return this.deps.links.get(workspaceId)
  }

  /** Records the status change a start made, inside the queue (RunWatcher is the link's writer). */
  recordStart(workspaceId: string, change: NonNullable<TaskLink['onStart']>): Promise<TaskLink | null> {
    const out: { link: TaskLink | null } = { link: null }
    return this.enqueue(async () => {
      const link = await this.deps.links.get(workspaceId)
      if (!link) return
      const next: TaskLink = { ...link, onStart: change }
      await this.deps.links.put(next)
      this.deps.post('link.changed', next)
      out.link = next
    }).then(() => out.link)
  }

  /** Stops tracking a run: the link goes, the worktree and its terminals stay. */
  forget(workspaceId: string): Promise<void> {
    return this.enqueue(async () => {
      this.pending.delete(workspaceId)
      const removed = await this.deps.links.remove(workspaceId)
      if (removed) this.deps.post('link.removed', { workspaceId })
    })
  }

  private async checkOne(workspaceId: string): Promise<TaskLink | null> {
    const link = await this.deps.links.get(workspaceId)
    if (!link) return null
    const { state } = link.run
    if (state === 'done') return link
    const { gateway } = this.deps

    let agents
    try {
      agents = await gateway.listAgents(workspaceId)
    } catch (error) {
      // The workspace is gone or on a host Orca cannot reach now; workspace.removed handles the first.
      gateway.log(`run check: agents.list failed for ${workspaceId}: ${String(error)}`)
      return link
    }
    const late = this.deps.clock() - link.run.since >= STALL_MS
    if (agents.length > 0) {
      const main = agents.find((a) => a.terminalId !== null && a.terminalId === link.terminalId) ?? agents[0]!
      const known = link.terminalId || !main.terminalId ? link : { ...link, terminalId: main.terminalId }
      if (known !== link) await this.deps.links.put(known)
      if (main.state === 'done' && !link.run.sawWorking) {
        // Open but never worked: its prompt may not have arrived.
        if (state === 'starting' && late) return this.setProblem(known, { kind: 'agent_idle' })
        return this.deps.links.get(workspaceId)
      }
      // An agent is there: its state is the truth. Replays it as an event so the usual rules apply.
      if (state !== main.state) await this.apply({ workspaceListId: workspaceId, state: main.state })
      return this.deps.links.get(workspaceId)
    }
    if (state === 'starting' && !late) return link
    return this.setProblem(link, { kind: 'no_agent' })
  }

  /** Stores a 'stalled' run (unless nothing changed) and posts it. */
  private async setProblem(link: TaskLink, problem: RunProblem): Promise<TaskLink> {
    const stored = await this.deps.links.get(link.workspaceId)
    if (stored?.run.state === 'stalled' && stored.run.problem?.kind === problem.kind && stored.terminalId === link.terminalId) return stored
    const updated: TaskLink = {
      ...link,
      run: {
        state: 'stalled',
        // Keep the time the trouble began across repeated checks.
        since: link.run.state === 'stalled' ? link.run.since : this.deps.clock(),
        sawWorking: link.run.sawWorking,
        problem
      }
    }
    await this.deps.links.put(updated)
    this.deps.post('link.changed', updated)
    return updated
  }

  private async apply(event: AgentStatusEvent): Promise<void> {
    const id = event.workspaceListId
    if (!id) return
    const link = await this.deps.links.get(id)
    if (!link) {
      this.buffer(id, event)
      return
    }
    const reported: RunState = event.mainAgent?.state ?? event.state
    const prev = link.run
    const sawWorking = prev.sawWorking || reported === 'working'
    // Orca's launch blip ('done' before any work) is no finish: the run is still starting.
    const next: RunState = reported === 'done' && !sawWorking ? 'starting' : reported
    if (prev.state === next && prev.sawWorking === sawWorking) return

    let updated: TaskLink = { ...link, run: { state: next, since: this.deps.clock(), sawWorking } }
    await this.deps.links.put(updated)
    this.deps.post('link.changed', updated)

    // Only a real finish: into 'done' after the agent has worked. The launch blip has no work yet.
    // 'blocked'/'waiting' after work means the agent needs the person.
    const finished = next === 'done' && prev.state !== 'done' && prev.sawWorking
    const needsInput = (next === 'blocked' || next === 'waiting') && prev.state !== next && sawWorking
    if (finished && !link.onDone && this.deps.onFirstFinish) {
      const change = await this.deps.onFirstFinish(updated).catch((error: unknown) => {
        this.deps.gateway.log(`done transition failed: ${String(error)}`)
        return null
      })
      if (change) {
        updated = { ...updated, onDone: change }
        await this.deps.links.put(updated)
        this.deps.post('link.changed', updated)
      }
    }
    if (!finished && !needsInput) return

    const settings = await this.deps.settings().catch((error: unknown) => {
      this.deps.gateway.log(`settings read failed: ${String(error)}`)
      return null
    })
    if (!settings) return
    const label = this.deps.agentLabel(link.agent)
    if (finished && settings.notifyOnDone) {
      const moved = updated.onDone?.status ? ` Moved to “${updated.onDone.status}”.` : ''
      await this.notify(`${label} finished`, `${link.taskName}: review it in Orca.${moved}`)
    } else if (needsInput && settings.notifyOnNeedsInput) {
      await this.notify(`${label} needs input`, `${link.taskName}: open the workspace to answer.`)
    }
  }

  private async notify(title: string, body: string): Promise<void> {
    await this.deps.gateway
      .notify({ title, body })
      .catch((error: unknown) => this.deps.gateway.log(`notify failed: ${String(error)}`))
  }

  private buffer(id: string, event: AgentStatusEvent): void {
    const now = this.deps.clock()
    for (const [key, entry] of this.pending) {
      if (now - entry.at > BUFFER_MS) this.pending.delete(key)
    }
    const entry = this.pending.get(id) ?? { at: now, events: [] }
    entry.events.push(event)
    if (entry.events.length > BUFFER_MAX) entry.events.shift()
    this.pending.set(id, entry)
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    const run = this.queue.then(work, work)
    this.queue = run.catch((error: unknown) => this.deps.gateway.log(`run-watcher: ${String(error)}`))
    return run
  }
}
