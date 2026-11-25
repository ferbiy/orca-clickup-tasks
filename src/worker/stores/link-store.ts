// Task <-> workspace links in storage key 'links' (a JSON array). Worker-only.
import type { JsonValue } from 'orca'
import type { RunState, TaskLink } from '../../shared/model'
import type { KeyValueStore } from '../ports'

const KEY = 'links'
const MAX_LINKS = 200
const RUN_STATES: readonly string[] = ['starting', 'working', 'blocked', 'waiting', 'done', 'stalled']
const PROBLEM_KINDS: readonly string[] = ['no_agent', 'agent_idle']
const CONTEXT_MODES: readonly string[] = ['link-and-snapshot', 'link-only', 'snapshot-only']

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isStatusChange(v: unknown): boolean {
  return isRecord(v) && (v.status === null || typeof v.status === 'string') && typeof v.note === 'string' && typeof v.at === 'number'
}

/**
 * Links written by the upstream plugin may carry states and fields this fork dropped ('failed',
 * terminal lines, the agent's ClickUp report). They are read as 'stalled' without them.
 */
function migrate(v: unknown): unknown {
  if (!isRecord(v) || !isRecord(v.run)) return v
  const run = { ...v.run }
  if (run.state === 'failed') run.state = 'stalled'
  if (isRecord(run.problem)) {
    const kind = run.problem.kind === 'agent_idle' ? 'agent_idle' : 'no_agent'
    run.problem = { kind }
  }
  const { contextReport: _report, ...rest } = v
  return { ...rest, run }
}

function isLink(v: unknown): v is TaskLink {
  if (!isRecord(v)) return false
  const run = v.run
  return (
    typeof v.taskId === 'string' &&
    typeof v.taskName === 'string' &&
    typeof v.taskUrl === 'string' &&
    typeof v.listId === 'string' &&
    typeof v.workspaceId === 'string' &&
    typeof v.projectId === 'string' &&
    typeof v.branch === 'string' &&
    typeof v.agent === 'string' &&
    typeof v.createdAt === 'number' &&
    isRecord(run) &&
    typeof run.state === 'string' &&
    RUN_STATES.includes(run.state as RunState) &&
    typeof run.since === 'number' &&
    typeof run.sawWorking === 'boolean' &&
    (run.problem === undefined || isProblem(run.problem)) &&
    (v.terminalId === undefined || v.terminalId === null || typeof v.terminalId === 'string') &&
    (v.taskContext === undefined || CONTEXT_MODES.includes(v.taskContext as string)) &&
    (v.hostId === undefined || typeof v.hostId === 'string') &&
    (v.onStart === undefined || isStatusChange(v.onStart)) &&
    (v.onDone === undefined || isStatusChange(v.onDone))
  )
}

function isProblem(v: unknown): boolean {
  return (
    isRecord(v) &&
    typeof v.kind === 'string' &&
    PROBLEM_KINDS.includes(v.kind)
  )
}

export class LinkStore {
  constructor(private readonly kv: KeyValueStore) {}

  private async read(): Promise<TaskLink[]> {
    const raw = await this.kv.get(KEY)
    if (!Array.isArray(raw)) return []
    return (raw as unknown[]).map(migrate).filter(isLink)
  }

  /** Newest first (by createdAt). */
  async list(): Promise<TaskLink[]> {
    const links = await this.read()
    return links.sort((a, b) => b.createdAt - a.createdAt)
  }

  async get(workspaceId: string): Promise<TaskLink | null> {
    return (await this.read()).find((l) => l.workspaceId === workspaceId) ?? null
  }

  /** Links for a task, newest first (a task may be started more than once). */
  async findByTask(taskId: string): Promise<TaskLink[]> {
    return (await this.list()).filter((l) => l.taskId === taskId)
  }

  /** Inserts or replaces by workspaceId. Keeps at most 200 links, dropping the oldest. */
  async put(link: TaskLink): Promise<void> {
    const rest = (await this.read()).filter((l) => l.workspaceId !== link.workspaceId)
    const next = [link, ...rest].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_LINKS)
    await this.kv.set(KEY, next as unknown as JsonValue)
  }

  /** Returns the removed link, or null. */
  async remove(workspaceId: string): Promise<TaskLink | null> {
    const links = await this.read()
    const found = links.find((l) => l.workspaceId === workspaceId) ?? null
    if (!found) return null
    await this.kv.set(KEY, links.filter((l) => l.workspaceId !== workspaceId) as unknown as JsonValue)
    return found
  }
}
