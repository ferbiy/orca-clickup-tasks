// Small preferences. Keys: 'prefs.teamId', 'prefs.userId', 'prefs.projectByList'
// ({ [listId]: projectId }), 'prefs.settings' (PluginSettings), 'prefs.missingAgents' (agent ids
// whose CLI was not found the last time they were started), 'prefs.agentClickUp'
// ({ [agentId]: { access, at } }: what the agent itself reported about its ClickUp tool).
// The old 'prefs.agent' key is still read as the fallback for settings.defaultAgent. Worker-only.
import type { JsonValue } from 'orca'
import type { AgentClickUpAccess, PluginSettings, TaskContextMode } from '../../shared/model'
import type { KeyValueStore } from '../ports'

export const DEFAULT_SETTINGS: Readonly<PluginSettings> = {
  defaultAgent: 'claude',
  moveToInProgress: true,
  defaultBaseBranch: '',
  notifyOnDone: true,
  notifyOnNeedsInput: false,
  taskContext: 'auto'
}

const CONTEXT_MODES: readonly string[] = ['auto', 'link-and-snapshot', 'link-only', 'snapshot-only']

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

  /** Agent ids whose CLI was not found the last time a run started them. */
  async missingAgents(): Promise<string[]> {
    const raw = await this.kv.get('prefs.missingAgents')
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []
  }
  async setAgentMissing(agent: string, missing: boolean): Promise<void> {
    const now = await this.missingAgents()
    if (now.includes(agent) === missing) return
    await this.kv.set('prefs.missingAgents', missing ? [...now, agent] : now.filter((a) => a !== agent))
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

  private async clickUpMap(): Promise<Record<string, { access: AgentClickUpAccess; at: number }>> {
    const raw = await this.kv.get('prefs.agentClickUp')
    const out: Record<string, { access: AgentClickUpAccess; at: number }> = {}
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out
    for (const [agent, v] of Object.entries(raw)) {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) continue
      const access = (v as Record<string, unknown>).access
      const at = (v as Record<string, unknown>).at
      if ((access === 'tool' || access === 'none') && typeof at === 'number') out[agent] = { access, at }
    }
    return out
  }

  /** The access `agent` last reported, or null when it never reported (or was forgotten). */
  async agentClickUp(agent: string): Promise<AgentClickUpAccess | null> {
    return (await this.clickUpMap())[agent]?.access ?? null
  }

  /** All learned reports, for the Start form's agent labels and the Settings list. */
  async agentClickUpAll(): Promise<Record<string, AgentClickUpAccess>> {
    const map = await this.clickUpMap()
    const out: Record<string, AgentClickUpAccess> = {}
    for (const [agent, v] of Object.entries(map)) out[agent] = v.access
    return out
  }

  /** Records what an agent printed on a run (RunWatcher's CU-CTX read). Latest wins. */
  async setAgentClickUp(agent: string, access: AgentClickUpAccess, at: number): Promise<void> {
    const map = await this.clickUpMap()
    map[agent] = { access, at }
    await this.kv.set('prefs.agentClickUp', map as JsonValue)
  }

  /** "Forget what agents can read": drops every learned report. */
  async forgetAgentClickUp(): Promise<void> {
    await this.kv.delete('prefs.agentClickUp')
  }
}
