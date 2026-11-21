// Turns Orca's agent status events into per-task run state, and notifies once per finished run.
// Facts it relies on (spike, 2026-11-20): events name the workspace by `workspaceListId` (the id
// workspace.create returned), and Orca emits a 'done' blip at launch before the agent works.
// Orca sends nothing when the agent never starts (its CLI is missing: the shell just answers
// `command not found`), so `check` also looks for itself: agents.list, then the agent's terminal.
import { PluginError } from '../../shared/errors'
import type {
  AgentClickUpAccess,
  PluginSettings,
  ResolvedTaskContext,
  RunProblem,
  RunState,
  TaskLink
} from '../../shared/model'
import type { Clock, OrcaGateway, PanelPoster } from '../ports'
import type { LinkStore } from '../stores/link-store'
import { looksLikeMissingCommand, tailForDisplay } from './run-diagnosis'

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
  /** Remembers which agents' CLIs were not found, for the Start form. */
  agentHealth?: { setMissing(agent: string, missing: boolean): Promise<void> }
  /** Records what an agent reported about its ClickUp access (prefs.agentClickUp). */
  agentContext?: { record(agent: string, access: AgentClickUpAccess): Promise<void> }
  /** Runs `work` after `ms` (setTimeout in the worker). Without it, only explicit checks run. */
  schedule?: (work: () => void, ms: number) => void
}

/** A run with no agent seen this long after it began is 'stalled'. Setup scripts run first, so it is a guess. */
export const STALL_MS = 60_000
/** When a new run is checked on its own: soon (a missing CLI fails at once), then while it may be slow. */
const CHECK_AFTER_MS: readonly number[] = [8_000, 25_000, STALL_MS + 5_000, 180_000, 600_000]
const TERMINAL_LINES = 60
/**
 * The agent's access report (docs/TASK-CONTEXT.md §3): a line `CU-CTX=tool|none` it was asked to
 * print. Read from a much larger window than failure lines (the report scrolls up during long runs)
 * and checked ~25 s after the first 'working' and on the first real 'done'.
 */
export const CONTEXT_REPORT_LINES = 2000
const CONTEXT_REPORT_AFTER_MS = 25_000
const CONTEXT_REPORT_RE = /CU-CTX=(tool|none)\b/g

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
   * agents.list, else marks the run 'failed' (terminal shows the CLI is missing) or 'stalled'.
   * Resolves with the link as stored after, or null when it is not linked.
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

  /** Checks a new or restarted run a few times on its own, until it is no longer 'starting' or 'stalled'. */
  watchStart(workspaceId: string): void {
    const schedule = this.deps.schedule
    if (!schedule) return
    for (const ms of CHECK_AFTER_MS) {
      schedule(() => {
        void this.deps.links.get(workspaceId).then((link) => {
          if (link && (link.run.state === 'starting' || link.run.state === 'stalled')) return this.check(workspaceId)
          return null
        }).catch((error: unknown) => this.deps.gateway.log(`run check failed: ${String(error)}`))
      }, ms)
    }
  }

  /**
   * Starts an agent again in a linked workspace. `launch` runs inside the queue, so the new agent's
   * first events wait until the reset link is stored and cannot be overwritten by it.
   */
  relaunch(workspaceId: string, agent: string, launch: () => Promise<{ terminalId: string }>): Promise<TaskLink> {
    const out: { link: TaskLink | null } = { link: null }
    return this.enqueue(async () => {
      const link = await this.deps.links.get(workspaceId)
      if (!link) throw new PluginError('not_found', 'This run is no longer linked to the task.')
      const { terminalId } = await launch()
      const now = this.deps.clock()
      const next: TaskLink = { ...link, agent, terminalId, run: { state: 'starting', since: now, sawWorking: false } }
      await this.deps.links.put(next)
      this.deps.post('link.changed', next)
      out.link = next
    }).then(() => {
      this.watchStart(workspaceId)
      return out.link as TaskLink
    })
  }

  /** The task prompt was typed into the run's agent: the run is starting again, its problem gone. */
  promptSent(workspaceId: string): Promise<TaskLink | null> {
    const out: { link: TaskLink | null } = { link: null }
    return this.enqueue(async () => {
      const link = await this.deps.links.get(workspaceId)
      if (!link || link.run.sawWorking) return
      const next: TaskLink = { ...link, run: { state: 'starting', since: this.deps.clock(), sawWorking: false } }
      await this.deps.links.put(next)
      this.deps.post('link.changed', next)
      out.link = next
    }).then(() => {
      if (out.link) this.watchStart(workspaceId)
      return out.link
    })
  }

  /** The stored link for a workspace, or null. */
  linkFor(workspaceId: string): Promise<TaskLink | null> {
    return this.deps.links.get(workspaceId)
  }

  /**
   * A task prompt was sent (again) in `mode`: records the mode the run now uses and clears the
   * access report so the agent reports again. Works when the run already worked (unlike
   * `promptSent`, which deliberately does nothing then).
   */
  contextSent(workspaceId: string, mode: ResolvedTaskContext): Promise<TaskLink | null> {
    const out: { link: TaskLink | null } = { link: null }
    return this.enqueue(async () => {
      const link = await this.deps.links.get(workspaceId)
      if (!link) return
      if (link.taskContext === mode && link.contextReport === undefined) {
        out.link = link
        return
      }
      const next: TaskLink = { ...link, taskContext: mode }
      delete next.contextReport
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
    let link = await this.deps.links.get(workspaceId)
    if (!link) return null
    const { state } = link.run
    if (state === 'done') return link
    if (!link.contextReport) {
      await this.scanContextReport(workspaceId)
      link = (await this.deps.links.get(workspaceId)) ?? link
    }
    const { gateway } = this.deps

    let agents
    try {
      agents = await gateway.listAgents(workspaceId)
    } catch (error) {
      // The workspace is gone or on a host Orca cannot reach now; workspace.removed handles the first.
      gateway.log(`run check: agents.list failed for ${workspaceId}: ${String(error)}`)
      return link
    }
    if (agents.length > 0) {
      const main = agents.find((a) => a.terminalId !== null && a.terminalId === link.terminalId) ?? agents[0]!
      const known = link.terminalId ? link : { ...link, terminalId: main.terminalId }
      if (known !== link) await this.deps.links.put(known)
      if (main.state === 'done' && !link.run.sawWorking) {
        // The agent is open but has never worked: its prompt may not have arrived (Orca #41107:
        // a plugin's agent.launch sends the prompt before the agent is ready).
        if (state === 'starting' && this.deps.clock() - link.run.since >= STALL_MS) {
          const lines = await this.readLines(main.terminalId ?? known.terminalId ?? null)
          return this.setProblem(known, 'stalled', { kind: 'agent_idle', lines: lines ? tailForDisplay(lines) : [] })
        }
        if (state === 'failed' || (state === 'stalled' && link.run.problem?.kind !== 'agent_idle')) {
          await this.apply({ workspaceListId: workspaceId, state: 'done' })
        }
        return this.deps.links.get(workspaceId)
      }
      // An agent is there: its state is the truth. Replays it as an event so the usual rules apply.
      // ('starting', 'stalled' and 'failed' never equal an agent state, so they always move on.)
      if (state !== main.state) {
        await this.apply({ workspaceListId: workspaceId, state: main.state })
      }
      return this.deps.links.get(workspaceId)
    }

    // No agent in the workspace. Find its terminal (older links did not keep the id).
    const terminals = await gateway.listTerminals(workspaceId).catch((error: unknown) => {
      gateway.log(`run check: terminal.list failed: ${String(error)}`)
      return null
    })
    let terminalId = link.terminalId ?? null
    if (terminals?.length === 1 && !terminals.some((t) => t.id === terminalId)) {
      // No id kept (older links), or Orca's terminal.list names it differently from what
      // workspace.create returned: the workspace's only terminal is the agent's.
      terminalId = terminals[0]!.id
    }
    const terminalGone = terminalId !== null && terminals !== null && !terminals.some((t) => t.id === terminalId)
    const lines = terminalGone ? null : await this.readLines(terminalId)

    let problem: RunProblem
    let next: 'stalled' | 'failed'
    if (!link.run.sawWorking && lines && looksLikeMissingCommand(lines)) {
      next = 'failed'
      problem = { kind: 'agent_missing', lines: tailForDisplay(lines) }
    } else if (state === 'failed') {
      return link
    } else if (state === 'starting' && this.deps.clock() - link.run.since < STALL_MS) {
      return link
    } else {
      next = 'stalled'
      problem = { kind: terminalGone ? 'no_terminal' : 'no_agent', lines: lines ? tailForDisplay(lines) : [] }
    }

    return this.setProblem({ ...link, terminalId }, next, problem)
  }

  /** The newest lines of a terminal, or null (no id, gone, or `terminal:read` not granted yet). */
  private async readLines(terminalId: string | null): Promise<string[] | null> {
    if (!terminalId) return null
    return this.deps.gateway.readTerminal(terminalId, TERMINAL_LINES).catch((error: unknown) => {
      this.deps.gateway.log(`run check: terminal.read failed: ${String(error)}`)
      return null
    })
  }

  /** Stores a 'stalled' or 'failed' run (unless nothing changed), posts it, and tells the person about a failure. */
  private async setProblem(link: TaskLink, next: 'stalled' | 'failed', problem: RunProblem): Promise<TaskLink> {
    const stored = await this.deps.links.get(link.workspaceId)
    const state = stored?.run.state
    const same =
      state === next &&
      stored?.run.problem?.kind === problem.kind &&
      (stored?.run.problem?.lines ?? []).join('\n') === problem.lines.join('\n') &&
      stored?.terminalId === link.terminalId
    if (same && stored) return stored
    const updated: TaskLink = {
      ...link,
      run: {
        state: next,
        // Keep the time the trouble began across repeated checks.
        since: state === next ? link.run.since : this.deps.clock(),
        sawWorking: link.run.sawWorking,
        problem
      }
    }
    await this.deps.links.put(updated)
    this.deps.post('link.changed', updated)
    if (next === 'failed' && state !== 'failed') {
      const { gateway } = this.deps
      await this.deps.agentHealth?.setMissing(link.agent, true).catch((error: unknown) => gateway.log(`agent health: ${String(error)}`))
      const settings = await this.deps.settings().catch(() => null)
      if (settings && (settings.notifyOnDone || settings.notifyOnNeedsInput)) {
        await this.notify(`${this.deps.agentLabel(link.agent)} could not start`, `${link.taskName}: its command was not found. Retry with another agent from the panel.`)
      }
    }
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

    const updated: TaskLink = {
      ...link,
      run: { state: next, since: this.deps.clock(), sawWorking }
    }
    await this.deps.links.put(updated)
    this.deps.post('link.changed', updated)
    if (next === 'working' && !prev.sawWorking) {
      await this.deps.agentHealth?.setMissing(link.agent, false).catch((error: unknown) => this.deps.gateway.log(`agent health: ${String(error)}`))
      // The agent just started; its access report lands a little later, so look once in ~25 s.
      if (!link.contextReport) {
        const schedule = this.deps.schedule
        schedule?.(() => {
          void this.enqueue(() => this.scanContextReport(id)).catch((error: unknown) =>
            this.deps.gateway.log(`context scan failed: ${String(error)}`)
          )
        }, CONTEXT_REPORT_AFTER_MS)
      }
    }

    // Only a real finish: into 'done' after the agent has worked. The launch blip has no work yet.
    // 'blocked'/'waiting' after work means the agent needs the person.
    const finished = next === 'done' && prev.state !== 'done' && prev.sawWorking
    if (finished && !link.contextReport) await this.scanContextReport(id)
    const needsInput = (next === 'blocked' || next === 'waiting') && prev.state !== next && sawWorking
    if (!finished && !needsInput) return

    const settings = await this.deps.settings().catch((error: unknown) => {
      this.deps.gateway.log(`settings read failed: ${String(error)}`)
      return null
    })
    if (!settings) return
    const label = this.deps.agentLabel(link.agent)
    if (finished && settings.notifyOnDone) {
      await this.notify(`${label} finished`, `${link.taskName}: review it, then update ClickUp from the panel.`)
    } else if (needsInput && settings.notifyOnNeedsInput) {
      await this.notify(`${label} needs input`, `${link.taskName}: open the workspace to answer.`)
    }
  }

  /**
   * Looks for the agent's access report in its terminal (must run inside the queue). Last match
   * in the lines read wins so the agent can correct itself; a missing line changes nothing.
   */
  private async scanContextReport(workspaceId: string): Promise<void> {
    const link = await this.deps.links.get(workspaceId)
    if (!link || link.taskContext === undefined || link.taskContext === 'snapshot-only' || link.contextReport !== undefined || !link.terminalId) return
    const lines = await this.deps.gateway
      .readTerminal(link.terminalId, CONTEXT_REPORT_LINES)
      .catch((error: unknown) => {
        this.deps.gateway.log(`context scan: terminal.read failed: ${String(error)}`)
        return null
      })
    if (!lines) return
    let access: AgentClickUpAccess | null = null
    for (const text of lines) {
      for (const match of text.matchAll(CONTEXT_REPORT_RE)) {
        access = match[1] as AgentClickUpAccess
      }
    }
    if (access === null) return
    const next: TaskLink = { ...link, contextReport: access }
    await this.deps.links.put(next)
    this.deps.post('link.changed', next)
    await this.deps.agentContext
      ?.record(link.agent, access)
      .catch((error: unknown) => this.deps.gateway.log(`agent context: ${String(error)}`))
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
