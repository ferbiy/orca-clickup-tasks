// Small preferences. Keys: 'prefs.teamId', 'prefs.userId', 'prefs.projectByList'
// ({ [listId]: projectId }), 'prefs.settings' (PluginSettings), 'prefs.scope:<teamId>' (Scope: which
// Spaces, Folders and Lists Orca may see in that Workspace) and 'prefs.statusMap' ({ [listId]: { start?, done? } } status
// overrides). The old 'prefs.agent' key is still read as the fallback for settings.defaultAgent.
// Worker-only.
import type { JsonValue } from 'orca'
import { EMPTY_SCOPE, type PluginSettings, type Scope, type StatusOverride, type StatusTransition, type TaskContextMode } from '../../shared/model'
import type { KeyValueStore } from '../ports'

export const DEFAULT_SETTINGS: Readonly<PluginSettings> = {
  defaultAgent: 'claude',
  moveToInProgress: true,
  commentOnStart: true,
  moveOnDone: true,
  defaultBaseBranch: '',
  notifyOnDone: true,
  notifyOnNeedsInput: false,
  taskContext: 'link-and-snapshot'
}

const CONTEXT_MODES: readonly string[] = ['link-and-snapshot', 'link-only', 'snapshot-only']
const MAX_SCOPE_ENTRIES = 500

function ids(raw: unknown): string[] {
  return Array.isArray(raw) ? [...new Set(raw.filter((v): v is string => typeof v === 'string' && v !== ''))] : []
}

function placed(raw: unknown): { id: string; spaceId: string }[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: { id: string; spaceId: string }[] = []
  for (const v of raw) {
    const e = v as { id?: unknown; spaceId?: unknown } | null
    if (typeof e?.id !== 'string' || !e.id || typeof e.spaceId !== 'string' || !e.spaceId || seen.has(e.id)) continue
    seen.add(e.id)
    out.push({ id: e.id, spaceId: e.spaceId })
  }
  return out
}

/** A Scope from anything (stored JSON or panel input): wrong entries dropped, duplicates merged. */
export function normalizeScope(raw: unknown): Scope {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...EMPTY_SCOPE }
  const v = raw as Record<string, unknown>
  return {
    spaces: ids(v.spaces).slice(0, MAX_SCOPE_ENTRIES),
    folders: placed(v.folders).slice(0, MAX_SCOPE_ENTRIES),
    lists: placed(v.lists).slice(0, MAX_SCOPE_ENTRIES)
  }
}

function override(raw: unknown): StatusOverride | undefined {
  const v = raw as { mode?: unknown; name?: unknown } | null
  if (v?.mode === 'none') return { mode: 'none' }
  if (v?.mode === 'status' && typeof v.name === 'string' && v.name.trim() !== '') return { mode: 'status', name: v.name }
  return undefined
}

export class PrefsStore {
  constructor(private readonly kv: KeyValueStore) {}

  private async str(key: string): Promise<string | null> {
    const v = await this.kv.get(key)
    return typeof v === 'string' && v !== '' ? v : null
  }

  private async setOrDelete(key: string, value: string | null): Promise<void> {
    if (value === null) await this.kv.delete(key)
    else await this.kv.set(key, value)
  }

  private async projectMap(): Promise<Record<string, string>> {
    const raw = await this.kv.get('prefs.projectByList')
    const out: Record<string, string> = {}
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out
    for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') out[k] = v
    return out
  }

  async teamId(): Promise<string | null> {
    return this.str('prefs.teamId')
  }
  async setTeamId(teamId: string | null): Promise<void> {
    await this.setOrDelete('prefs.teamId', teamId)
  }
  async userId(): Promise<string | null> {
    return this.str('prefs.userId')
  }
  async setUserId(userId: string | null): Promise<void> {
    await this.setOrDelete('prefs.userId', userId)
  }
  async projectForList(listId: string): Promise<string | null> {
    return (await this.projectMap())[listId] ?? null
  }
  async setProjectForList(listId: string, projectId: string): Promise<void> {
    const map = await this.projectMap()
    map[listId] = projectId
    await this.kv.set('prefs.projectByList', map as JsonValue)
  }

  /** The Spaces, Folders and Lists Orca may see in the selected Workspace. Empty until chosen. */
  async scope(): Promise<Scope> {
    const teamId = await this.teamId()
    return teamId ? normalizeScope(await this.kv.get(`prefs.scope:${teamId}`)) : { ...EMPTY_SCOPE }
  }
  async setScope(scope: Scope): Promise<Scope> {
    const teamId = await this.teamId()
    if (!teamId) return { ...EMPTY_SCOPE }
    const next = normalizeScope(scope)
    await this.kv.set(`prefs.scope:${teamId}`, next as unknown as JsonValue)
    return next
  }

  private async statusMap(): Promise<Record<string, { start?: StatusOverride; done?: StatusOverride }>> {
    const raw = await this.kv.get('prefs.statusMap')
    const out: Record<string, { start?: StatusOverride; done?: StatusOverride }> = {}
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out
    for (const [listId, v] of Object.entries(raw)) {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) continue
      const start = override((v as Record<string, unknown>).start)
      const done = override((v as Record<string, unknown>).done)
      if (start || done) out[listId] = { ...(start ? { start } : {}), ...(done ? { done } : {}) }
    }
    return out
  }
  /** The person's choice for one List and transition; `{ mode: 'auto' }` when none is saved. */
  async statusOverride(listId: string, which: StatusTransition): Promise<StatusOverride> {
    return (await this.statusMap())[listId]?.[which] ?? { mode: 'auto' }
  }
  async setStatusOverride(listId: string, which: StatusTransition, value: StatusOverride): Promise<void> {
    const map = await this.statusMap()
    const entry = { ...(map[listId] ?? {}) }
    if (value.mode === 'auto') delete entry[which]
    else entry[which] = value
    if (entry.start || entry.done) map[listId] = entry
    else delete map[listId]
    await this.kv.set('prefs.statusMap', map as unknown as JsonValue)
  }

  /** Stored settings merged over the defaults; a missing or wrong-typed field reads as its default. */
  async settings(): Promise<PluginSettings> {
    const raw = await this.kv.get('prefs.settings')
    const stored: Record<string, unknown> = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}
    const d = DEFAULT_SETTINGS
    const str = (key: keyof PluginSettings, fallback: string): string => {
      const v = stored[key]
      return typeof v === 'string' ? v : fallback
    }
    const bool = (key: keyof PluginSettings, fallback: boolean): boolean => {
      const v = stored[key]
      return typeof v === 'boolean' ? v : fallback
    }
    // Migration: before settings existed the last-used agent lived in 'prefs.agent'.
    const legacyAgent = (await this.str('prefs.agent')) ?? d.defaultAgent
    const agent = stored.defaultAgent
    return {
      defaultAgent: typeof agent === 'string' && agent !== '' ? agent : legacyAgent,
      moveToInProgress: bool('moveToInProgress', d.moveToInProgress),
      commentOnStart: bool('commentOnStart', d.commentOnStart),
      moveOnDone: bool('moveOnDone', d.moveOnDone),
      defaultBaseBranch: str('defaultBaseBranch', d.defaultBaseBranch),
      notifyOnDone: bool('notifyOnDone', d.notifyOnDone),
      notifyOnNeedsInput: bool('notifyOnNeedsInput', d.notifyOnNeedsInput),
      taskContext: CONTEXT_MODES.includes(stored.taskContext as string)
        ? (stored.taskContext as TaskContextMode)
        : d.taskContext
    }
  }

  /** Merges an already validated patch and saves. Returns the new settings. */
  async updateSettings(patch: Partial<PluginSettings>): Promise<PluginSettings> {
    const next: PluginSettings = { ...(await this.settings()), ...patch }
    await this.kv.set('prefs.settings', next as unknown as JsonValue)
    return next
  }
}
