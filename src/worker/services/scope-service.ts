// Which Lists Orca may see. The person picks Spaces, Folders and/or Lists; this turns that into the
// concrete List ids every task query is limited to, and refuses any task outside them, so tasks of
// other Lists are never shown or put into an agent prompt.
import { PluginError } from '../../shared/errors'
import type { Scope, SpaceChildren } from '../../shared/model'
import type { Clock } from '../ports'
import type { CacheStore } from '../stores/cache-store'
import { normalizeScope, type PrefsStore } from '../stores/prefs-store'

export interface ScopeServiceDeps {
  prefs: PrefsStore
  cache: CacheStore
  /** A Space's Folders and Lists (TaskService.children: cached for an hour). */
  childrenOf: (spaceId: string) => Promise<SpaceChildren>
  clock: Clock
  /** How long a resolved id set is reused before Space and Folder contents are read again. */
  memoMs?: number
}

export class ScopeService {
  private memo: { at: number; key: string; ids: Set<string> } | null = null

  constructor(private readonly deps: ScopeServiceDeps) {}

  get(): Promise<Scope> {
    return this.deps.prefs.scope()
  }

  /** Saves a new choice; the cached task list is dropped since it may hold tasks now outside. */
  async set(input: unknown): Promise<Scope> {
    const next = await this.deps.prefs.setScope(normalizeScope(input))
    this.memo = null
    await this.deps.cache.clearTasks()
    return next
  }

  isEmpty(scope: Scope): boolean {
    return scope.spaces.length === 0 && scope.folders.length === 0 && scope.lists.length === 0
  }

  /**
   * The List ids in scope: chosen Lists, every List of a chosen Folder, every List of a chosen
   * Space (its Folders' and its folderless ones). Spaces that hold a chosen Folder are read once.
   */
  async listIds(): Promise<Set<string>> {
    const scope = await this.get()
    const key = JSON.stringify(scope)
    const now = this.deps.clock()
    if (this.memo && this.memo.key === key && now - this.memo.at < (this.deps.memoMs ?? 5 * 60_000)) return this.memo.ids
    const ids = new Set(scope.lists.map((l) => l.id))
    const folderIds = new Set(scope.folders.map((f) => f.id))
    const spaces = new Set([...scope.spaces, ...scope.folders.map((f) => f.spaceId)])
    for (const spaceId of spaces) {
      const children = await this.deps.childrenOf(spaceId)
      const whole = scope.spaces.includes(spaceId)
      for (const folder of children.folders) {
        if (whole || folderIds.has(folder.id)) for (const list of folder.lists) ids.add(list.id)
      }
      if (whole) for (const list of children.lists) ids.add(list.id)
    }
    this.memo = { at: now, key, ids }
    return ids
  }

  /**
   * The Lists in scope with their names and Folder (null for a folderless List), for pickers. Reads
   * the same cached Space contents as listIds, plus the Spaces of individually chosen Lists.
   */
  async lists(): Promise<{ id: string; name: string; folder: string | null }[]> {
    const scope = await this.get()
    const ids = await this.listIds()
    const spaces = new Set([...scope.spaces, ...scope.folders.map((f) => f.spaceId), ...scope.lists.map((l) => l.spaceId)])
    const out: { id: string; name: string; folder: string | null }[] = []
    const seen = new Set<string>()
    const add = (id: string, name: string, folder: string | null) => {
      if (!ids.has(id) || seen.has(id)) return
      seen.add(id)
      out.push({ id, name, folder })
    }
    for (const spaceId of spaces) {
      const children = await this.deps.childrenOf(spaceId)
      for (const folder of children.folders) for (const list of folder.lists) add(list.id, list.name, folder.name)
      for (const list of children.lists) add(list.id, list.name, null)
    }
    // A chosen List ClickUp no longer shows in its Space (moved, hidden): still in scope, unnamed.
    for (const id of ids) add(id, `List ${id}`, null)
    return out
  }

  /** Refuses a List outside the chosen ones. */
  async assertList(listId: string): Promise<void> {
    if (!(await this.listIds()).has(listId)) {
      throw new PluginError('out_of_scope', 'This task is in a List that is not chosen for Orca (Settings › Lists).')
    }
  }
}
