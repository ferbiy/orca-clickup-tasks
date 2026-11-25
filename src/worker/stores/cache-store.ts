// Cached ClickUp reads. Keys: 'cache.tasks' -> { teamId, fetchedAt, tasks },
// 'cache.statuses' -> { [listId]: { fetchedAt, statuses } },
// 'cache.spaces' -> { teamId, fetchedAt, spaces }, 'cache.children' -> { [spaceId]: { fetchedAt, children } }.
// Worker-only.
import type { JsonValue } from 'orca'
import type { FolderRef, ListRef, Person, SpaceChildren, SpaceRef, StatusOption, TaskSummary } from '../../shared/model'
import type { KeyValueStore } from '../ports'

const TASKS_KEY = 'cache.tasks'
const STATUSES_KEY = 'cache.statuses'
const SPACES_KEY = 'cache.spaces'
const CHILDREN_KEY = 'cache.children'
const MEMBERS_KEY = 'cache.members'
const SPACE_TAGS_KEY = 'cache.spaceTags'
const STATUS_TYPES: readonly string[] = ['open', 'custom', 'done', 'closed']

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isNumberOrNull(v: unknown): v is number | null {
  return v === null || typeof v === 'number'
}

function isTask(v: unknown): v is TaskSummary {
  return (
    isRecord(v) &&
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    isRecord(v.status) &&
    typeof v.status.name === 'string' &&
    isRecord(v.list) &&
    typeof v.list.id === 'string' &&
    isNumberOrNull(v.createdAt) &&
    isNumberOrNull(v.timeEstimateMs)
  )
}

function isStatus(v: unknown): v is StatusOption {
  return (
    isRecord(v) &&
    typeof v.name === 'string' &&
    typeof v.type === 'string' &&
    STATUS_TYPES.includes(v.type) &&
    typeof v.order === 'number'
  )
}

function isPerson(v: unknown): v is Person {
  return isRecord(v) && typeof v.id === 'string' && typeof v.name === 'string' && typeof v.initials === 'string'
}

function isNamed(v: unknown): v is { id: string; name: string } {
  return isRecord(v) && typeof v.id === 'string' && typeof v.name === 'string'
}

function isList(v: unknown): v is ListRef {
  if (!isNamed(v)) return false
  const count = (v as Record<string, unknown>).taskCount
  return count === null || typeof count === 'number'
}

function isFolder(v: unknown): v is FolderRef {
  if (!isNamed(v)) return false
  const lists = (v as Record<string, unknown>).lists
  return Array.isArray(lists) && lists.every(isList)
}

function isChildren(v: unknown): v is SpaceChildren {
  return (
    isRecord(v) &&
    typeof v.spaceId === 'string' &&
    Array.isArray(v.folders) &&
    (v.folders as unknown[]).every(isFolder) &&
    Array.isArray(v.lists) &&
    (v.lists as unknown[]).every(isList)
  )
}

interface TasksEntry {
  teamId: string
  fetchedAt: number
  tasks: TaskSummary[]
}

export class CacheStore {
  constructor(private readonly kv: KeyValueStore) {}

  private async readEntry(): Promise<TasksEntry | null> {
    const raw = await this.kv.get(TASKS_KEY)
    if (!isRecord(raw) || typeof raw.teamId !== 'string' || typeof raw.fetchedAt !== 'number' || !Array.isArray(raw.tasks)) {
      return null
    }
    // All-or-nothing: one task without the current keys means the entry predates them (older plugin
    // version), so treat the whole list as absent and refetch instead of showing a partly filtered one.
    const tasks = raw.tasks as unknown[]
    if (!tasks.every(isTask)) return null
    return { teamId: raw.teamId, fetchedAt: raw.fetchedAt, tasks }
  }

  /** null when nothing is cached or the cache belongs to another team. */
  async readTasks(teamId: string): Promise<{ fetchedAt: number; tasks: TaskSummary[] } | null> {
    const e = await this.readEntry()
    if (!e || e.teamId !== teamId) return null
    return { fetchedAt: e.fetchedAt, tasks: e.tasks }
  }

  async writeTasks(teamId: string, fetchedAt: number, tasks: TaskSummary[]): Promise<void> {
    const entry: TasksEntry = { teamId, fetchedAt, tasks }
    await this.kv.set(TASKS_KEY, entry as unknown as JsonValue)
  }

  /** Replaces one task in the cached list if present (after an update). */
  async patchTask(task: TaskSummary): Promise<void> {
    const e = await this.readEntry()
    if (!e || !e.tasks.some((t) => t.id === task.id)) return
    e.tasks = e.tasks.map((t) => (t.id === task.id ? task : t))
    await this.kv.set(TASKS_KEY, e as unknown as JsonValue)
  }

  private async readStatusMap(): Promise<Record<string, { fetchedAt: number; statuses: StatusOption[] }>> {
    const raw = await this.kv.get(STATUSES_KEY)
    const out: Record<string, { fetchedAt: number; statuses: StatusOption[] }> = {}
    if (!isRecord(raw)) return out
    for (const [listId, v] of Object.entries(raw)) {
      if (isRecord(v) && typeof v.fetchedAt === 'number' && Array.isArray(v.statuses) && (v.statuses as unknown[]).every(isStatus)) {
        out[listId] = { fetchedAt: v.fetchedAt, statuses: v.statuses as unknown as StatusOption[] }
      }
    }
    return out
  }

  /** null when absent or older than maxAgeMs relative to now. */
  async readStatuses(listId: string, now: number, maxAgeMs: number): Promise<StatusOption[] | null> {
    const entry = (await this.readStatusMap())[listId]
    if (!entry || now - entry.fetchedAt > maxAgeMs) return null
    return entry.statuses
  }

  async writeStatuses(listId: string, fetchedAt: number, statuses: StatusOption[]): Promise<void> {
    const map = await this.readStatusMap()
    map[listId] = { fetchedAt, statuses }
    await this.kv.set(STATUSES_KEY, map as unknown as JsonValue)
  }

  /** Spaces of `teamId`, or null when absent, for another team, or older than maxAgeMs. */
  async readSpaces(teamId: string, now: number, maxAgeMs: number): Promise<SpaceRef[] | null> {
    const raw = await this.kv.get(SPACES_KEY)
    if (!isRecord(raw) || raw.teamId !== teamId || typeof raw.fetchedAt !== 'number' || !Array.isArray(raw.spaces)) return null
    if (now - raw.fetchedAt > maxAgeMs || !(raw.spaces as unknown[]).every(isNamed)) return null
    return raw.spaces as unknown as SpaceRef[]
  }

  async writeSpaces(teamId: string, fetchedAt: number, spaces: SpaceRef[]): Promise<void> {
    await this.kv.set(SPACES_KEY, { teamId, fetchedAt, spaces } as unknown as JsonValue)
  }

  /** Space ids are unique across Workspaces, so children need no team key; clear() drops them. */
  async readChildren(spaceId: string, now: number, maxAgeMs: number): Promise<SpaceChildren | null> {
    const raw = await this.kv.get(CHILDREN_KEY)
    const entry = isRecord(raw) ? raw[spaceId] : null
    if (!isRecord(entry) || typeof entry.fetchedAt !== 'number' || !isChildren(entry.children)) return null
    if (now - entry.fetchedAt > maxAgeMs) return null
    return entry.children
  }

  async writeChildren(fetchedAt: number, children: SpaceChildren): Promise<void> {
    const raw = await this.kv.get(CHILDREN_KEY)
    const map: Record<string, unknown> = isRecord(raw) ? { ...raw } : {}
    for (const [id, v] of Object.entries(map)) {
      // Keep the map small: drop entries well past any useful age.
      if (!isRecord(v) || typeof v.fetchedAt !== 'number' || fetchedAt - v.fetchedAt > 24 * 60 * 60_000) delete map[id]
    }
    map[children.spaceId] = { fetchedAt, children }
    await this.kv.set(CHILDREN_KEY, map as unknown as JsonValue)
  }

  /** Members of `teamId`, or null when absent, for another team, or older than maxAgeMs. */
  async readMembers(teamId: string, now: number, maxAgeMs: number): Promise<Person[] | null> {
    const raw = await this.kv.get(MEMBERS_KEY)
    if (!isRecord(raw) || raw.teamId !== teamId || typeof raw.fetchedAt !== 'number' || !Array.isArray(raw.members)) return null
    if (now - raw.fetchedAt > maxAgeMs || !(raw.members as unknown[]).every(isPerson)) return null
    return raw.members as unknown as Person[]
  }

  async writeMembers(teamId: string, fetchedAt: number, members: Person[]): Promise<void> {
    await this.kv.set(MEMBERS_KEY, { teamId, fetchedAt, members } as unknown as JsonValue)
  }

  private async readTagMap(): Promise<Record<string, { fetchedAt: number; tags: string[] }>> {
    const raw = await this.kv.get(SPACE_TAGS_KEY)
    const out: Record<string, { fetchedAt: number; tags: string[] }> = {}
    if (!isRecord(raw)) return out
    for (const [spaceId, v] of Object.entries(raw)) {
      if (
        isRecord(v) &&
        typeof v.fetchedAt === 'number' &&
        Array.isArray(v.tags) &&
        (v.tags as unknown[]).every((t) => typeof t === 'string')
      ) {
        out[spaceId] = { fetchedAt: v.fetchedAt, tags: v.tags as unknown as string[] }
      }
    }
    return out
  }

  /** Tag names of `spaceId`, or null when absent or older than maxAgeMs. */
  async readSpaceTags(spaceId: string, now: number, maxAgeMs: number): Promise<string[] | null> {
    const entry = (await this.readTagMap())[spaceId]
    if (!entry || now - entry.fetchedAt > maxAgeMs) return null
    return entry.tags
  }

  async writeSpaceTags(spaceId: string, fetchedAt: number, tags: string[]): Promise<void> {
    const map = await this.readTagMap()
    map[spaceId] = { fetchedAt, tags }
    await this.kv.set(SPACE_TAGS_KEY, map as unknown as JsonValue)
  }

  /** Drops only the cached task list (the chosen Lists changed: what is cached may be outside them). */
  async clearTasks(): Promise<void> {
    await this.kv.delete(TASKS_KEY)
  }

  /** Drops every cache key (on disconnect or team change). */
  async clear(): Promise<void> {
    await this.kv.delete(TASKS_KEY)
    await this.kv.delete(STATUSES_KEY)
    await this.kv.delete(SPACES_KEY)
    await this.kv.delete(CHILDREN_KEY)
    await this.kv.delete(MEMBERS_KEY)
    await this.kv.delete(SPACE_TAGS_KEY)
  }
}
